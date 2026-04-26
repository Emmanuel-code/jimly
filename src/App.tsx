import { useState, useEffect } from 'react';
import { auth, db, handleFirestoreError, OperationType } from './lib/firebase';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User as FirebaseUser 
} from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  getDoc, 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  serverTimestamp, 
  addDoc,
  updateDoc
} from 'firebase/firestore';
import { 
  Send, 
  Inbox, 
  ChevronRight, 
  ArrowLeft,
  X,
  Sparkles,
  Share2,
  Trash2,
  Ghost,
  Volume2,
  CheckCircle2,
  Smile
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getMessageVibe, getMessageHint } from './lib/gemini';

// --- Types ---
interface UserProfile {
  userId: string;
  username: string;
  displayName: string;
  photoURL: string;
  currentPrompt?: string;
  promptVibe?: string;
}

interface Message {
  id: string;
  content: string;
  createdAt: any;
  status: 'unread' | 'read';
  hint?: string;
  guessWho?: boolean;
  guessNames?: string[];
  guessResult?: 'correct' | 'incorrect';
  senderName?: string;
  senderFirstName?: string;
  senderPhoto?: string;
}

const PROMPTS = [
  { id: 'ngl', label: 'Send me anonymous messages!', icon: '💬', color: 'from-orange-600 to-pink-600' },
  { id: 'roast', label: 'NGL... roast me 💀', icon: '🔥', color: 'from-red-600 to-orange-600' },
  { id: 'confess', label: 'Tell me a secret 🤫', icon: '🔒', color: 'from-purple-600 to-indigo-600' },
  { id: 'ship', label: 'Who should I date? 💘', icon: '❤️', color: 'from-pink-500 to-rose-400' },
  { id: 'truth', label: 'Truth or Dare? 🎲', icon: '👀', color: 'from-emerald-500 to-teal-600' },
];

export default function App() {
  const [view, setView] = useState<'landing' | 'onboarding' | 'dashboard' | 'profile' | 'inbox' | 'message' | 'feed'>('landing');
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [targetUser, setTargetUser] = useState<UserProfile | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [guessWho, setGuessWho] = useState(false);
  const [loading, setLoading] = useState(true);
  const [vibeCheck, setVibeCheck] = useState<string | null>(null);
  const [isGeneratingVibe, setIsGeneratingVibe] = useState(false);
  const [feedMessages, setFeedMessages] = useState<any[]>([]);

  // Auth Listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      
      const path = window.location.pathname.split('/')[1];
      const isReserved = ['dashboard', 'inbox', 'onboarding', 'feed', ''].includes(path);

      if (u) {
        const userDoc = await getDoc(doc(db, 'users', u.uid));
        if (userDoc.exists()) {
          const userData = userDoc.data() as UserProfile;
          setProfile(userData);
          
          if (path && !isReserved) {
            handleSearchProfile(path);
          } else {
            setView('dashboard');
          }
        } else {
          setView('onboarding');
        }
      } else {
        if (path && !isReserved) {
          handleSearchProfile(path);
        } else {
          setView('landing');
        }
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  // Messages Listener
  useEffect(() => {
    if (user && (view === 'inbox' || view === 'dashboard')) {
      const q = query(
        collection(db, `users/${user.uid}/messages`),
        orderBy('createdAt', 'desc')
      );
      const unsub = onSnapshot(q, (snap) => {
        setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() } as Message)));
      });
      return unsub;
    }
  }, [user, view]);

  // Feed Listener
  useEffect(() => {
    if (view === 'feed') {
      const q = query(collection(db, 'confessions'), orderBy('createdAt', 'desc'));
      const unsub = onSnapshot(q, (snap) => {
        setFeedMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      });
      return unsub;
    }
  }, [view]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const copyLink = () => {
    if (!profile) return;
    const link = `${window.location.origin}/${profile.username}`;
    navigator.clipboard.writeText(link);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleShare = async () => {
    if (!profile) return;
    const shareData = {
      title: 'Jimly',
      text: profile.currentPrompt || 'Send me anonymous messages!',
      url: `${window.location.origin}/${profile.username}`
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        console.log('Error sharing:', err);
        copyLink();
      }
    } else {
      copyLink();
    }
  };

  const handleSetUsername = async (username: string) => {
    if (!user || !username.trim()) return;
    const cleanUsername = username.toLowerCase().trim().replace(/[^a-z0-9_]/g, '');
    try {
      const nameDoc = await getDoc(doc(db, 'usernames', cleanUsername));
      if (nameDoc.exists()) { alert('Taken! Try another.'); return; }
      const newProfile: UserProfile = {
        userId: user.uid,
        username: cleanUsername,
        displayName: user.displayName || 'Anonymous',
        photoURL: user.photoURL || '',
        currentPrompt: PROMPTS[0].label,
        promptVibe: PROMPTS[0].id
      };
      await setDoc(doc(db, 'usernames', cleanUsername), { userId: user.uid });
      await setDoc(doc(db, 'users', user.uid), newProfile);
      setProfile(newProfile);
      setView('dashboard');
    } catch (e) { handleFirestoreError(e, OperationType.WRITE, 'users'); }
  };

  const handleUpdatePrompt = async (prompt: typeof PROMPTS[0]) => {
    if (!user || !profile) return;
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        currentPrompt: prompt.label,
        promptVibe: prompt.id
      });
      setProfile({ ...profile, currentPrompt: prompt.label, promptVibe: prompt.id });
    } catch (e) { console.error(e); }
  };

  const handleSearchProfile = async (username: string) => {
    setLoading(true);
    try {
      const nameDoc = await getDoc(doc(db, 'usernames', username.toLowerCase()));
      if (nameDoc.exists()) {
        const uid = nameDoc.data()?.userId;
        const userDoc = await getDoc(doc(db, 'users', uid));
        if (userDoc.exists()) {
          setTargetUser(userDoc.data() as UserProfile);
          setView('profile');
        }
      } else { setView(user ? 'dashboard' : 'landing'); }
    } catch (e) {
      console.error(e);
      setView(user ? 'dashboard' : 'landing');
    }
    setLoading(false);
  };

  const handleSendMessage = async (content: string) => {
    if (!targetUser || !content.trim()) return;
    
    // AI Safety Check
    try {
      const { checkToxicity } = await import('./lib/gemini');
      const isToxic = await checkToxicity(content);
      if (isToxic) {
        alert("Whoa there! Jimly is for real talk, not hate. Let's keep it cool. 🧊");
        return;
      }
    } catch (e) { console.error("Safety check failed", e); }

    // Guess Who shuffle
    let guessNames: string[] = [];
    const firstName = user?.displayName?.split(' ')[0] || 'Anon';
    if (guessWho && user) {
      const fakeShadows = ['Alex', 'Jordan', 'Sam', 'Charlie', 'Taylor', 'Casey', 'Riley', 'Morgan', 'Blake', 'Quinn'];
      const chosenFakes = fakeShadows.filter(n => n !== firstName).sort(() => 0.5 - Math.random()).slice(0, 3);
      guessNames = [firstName, ...chosenFakes].sort(() => 0.5 - Math.random());
    }

    try {
      await addDoc(collection(db, `users/${targetUser.userId}/messages`), {
        content: content.trim(),
        createdAt: serverTimestamp(),
        status: 'unread',
        guessWho: guessWho,
        guessNames: guessNames,
        senderUid: user?.uid || null,
        senderName: user?.displayName || null,
        senderFirstName: firstName,
        senderPhoto: user?.photoURL || null,
        senderUsername: profile?.username || null
      });
      setIsSent(true);
    } catch (e) { handleFirestoreError(e, OperationType.WRITE, 'messages'); }
  };

  const publishToFeed = async (content: string) => {
    try {
      await addDoc(collection(db, 'confessions'), {
        content,
        createdAt: serverTimestamp(),
        likes: 0
      });
      alert('Published to Global Feed! 🌍');
    } catch (e) { console.error(e); }
  };

  const handleLike = async (id: string, currentLikes: number) => {
    try {
      await updateDoc(doc(db, 'confessions', id), {
        likes: (currentLikes || 0) + 1
      });
    } catch (e) { console.error(e); }
  };

  const handleGuess = async (msg: Message, guess: string) => {
    if (!profile) return;
    const isCorrect = guess === msg.senderFirstName;
    try {
      const msgPath = `users/${profile.userId}/messages/${msg.id}`;
      await updateDoc(doc(db, msgPath), {
        guessResult: isCorrect ? 'correct' : 'incorrect'
      });
      // Update local state for immediate feedback
      setSelectedMessage({ ...msg, guessResult: isCorrect ? 'correct' : 'incorrect' });
      
      // Notify sender
      if (msg.senderUid) {
        const senderMsgPath = `users/${msg.senderUid}/messages`;
        await addDoc(collection(db, senderMsgPath), {
          content: isCorrect ? `THEY FOUND YOU! 🎯 Someone just correctly guessed you sent that message.` : `They guessed wrong! 🕵️ Someone tried to guess who you are and failed.`,
          createdAt: serverTimestamp(),
          status: 'unread',
          mood: 'system'
        });
      }
    } catch (e) { 
      handleFirestoreError(e, OperationType.WRITE, `users/${profile.userId}/messages/${msg.id}`);
    }
  };

  const generateVibeCheck = async () => {
    if (messages.length === 0) return;
    setIsGeneratingVibe(true);
    const vibe = await getMessageVibe(messages.map(m => m.content));
    setVibeCheck(vibe);
    setIsGeneratingVibe(false);
  };

  const generateHint = async (msg: Message) => {
    if (msg.hint) return;
    const hint = await getMessageHint(msg.content);
    const updatedMessages = messages.map(m => m.id === msg.id ? { ...m, hint } : m);
    setMessages(updatedMessages);
    setSelectedMessage({ ...msg, hint });
    // Update in DB too
    if (user) {
      await updateDoc(doc(db, `users/${user.uid}/messages`, msg.id), { hint });
    }
  };

  const speakMessage = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.pitch = 0.5; // Deep, "shadowy" voice
    utterance.rate = 0.8;
    window.speechSynthesis.speak(utterance);
  };

  if (loading) return <div className="h-screen flex items-center justify-center bg-black"><motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }} className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full" /></div>;

  return (
    <div className="min-h-screen bg-zinc-950 font-sans text-white overflow-x-hidden selection:bg-purple-500/30">
      <AnimatePresence mode="wait">
        {/* LANDING */}
        {view === 'landing' && (
          <motion.div key="landing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-screen flex flex-col items-center justify-center p-6 text-center">
            <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_-20%,rgba(168,85,247,0.15),transparent)] pointer-events-none" />
            <motion.div initial={{ y: 20 }} animate={{ y: 0 }} className="space-y-8 max-w-sm">
              <h1 className="text-8xl font-black italic tracking-tighter drop-shadow-2xl bg-gradient-to-br from-purple-500 to-pink-500 bg-clip-text text-transparent">jimly</h1>
              <p className="text-zinc-400 text-xl font-medium">Beyond honesty. Find the real talk.</p>
              <div className="space-y-3">
                <button onClick={handleLogin} className="w-full bg-white text-black font-black py-5 rounded-[2.5rem] text-xl shadow-xl hover:scale-105 active:scale-95 transition-all flex items-center justify-center gap-2">
                  Get Started <ChevronRight size={24} />
                </button>
                <button onClick={() => setView('feed')} className="w-full bg-zinc-900 text-white font-bold py-4 rounded-[2rem] text-lg hover:bg-zinc-800 transition-all">
                  Read Anonymous Feed
                </button>
              </div>
              <div className="flex justify-center gap-4 text-zinc-500 text-xs font-bold uppercase tracking-widest">
                <span>Safe</span> • <span>Encrypted</span> • <span>AI Powered</span>
              </div>
            </motion.div>
          </motion.div>
        )}

        {/* ONBOARDING */}
        {view === 'onboarding' && (
          <motion.div key="onboarding" initial={{ x: 100, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="h-screen flex flex-col items-center justify-center p-6">
            <div className="w-full max-w-md space-y-8">
              <h2 className="text-4xl font-black tracking-tight text-center">Your Link Name</h2>
              <form onSubmit={(e) => { e.preventDefault(); handleSetUsername((e.currentTarget.elements.namedItem('username') as HTMLInputElement).value); }} className="space-y-4">
                <div className="relative">
                  <span className="absolute left-6 top-1/2 -translate-y-1/2 text-zinc-600 font-bold text-xl">jimly.me/</span>
                  <input name="username" required autoFocus placeholder="name" className="w-full bg-zinc-900 border-2 border-zinc-800 rounded-[2rem] py-5 pl-24 pr-6 text-xl font-bold focus:border-purple-500 outline-none transition-all" />
                </div>
                <button className="w-full bg-purple-600 py-5 rounded-[2rem] text-xl font-black shadow-lg shadow-purple-600/20">Next</button>
              </form>
            </div>
          </motion.div>
        )}

        {/* DASHBOARD */}
        {view === 'dashboard' && profile && (
          <motion.div key="dashboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-h-screen flex flex-col p-6 max-w-lg mx-auto">
            <header className="flex items-center justify-between py-6">
              <h1 className="text-4xl font-black italic bg-gradient-to-br from-purple-500 to-pink-500 bg-clip-text text-transparent">jimly</h1>
              <div className="flex gap-3">
                <button onClick={() => setView('inbox')} className="bg-zinc-900 p-4 rounded-2xl relative">
                  <Inbox size={24} />
                  {messages.some(m => m.status === 'unread') && <span className="absolute top-3 right-3 w-3 h-3 bg-purple-500 rounded-full border-2 border-zinc-900 shadow-[0_0_10px_rgba(168,85,247,0.8)]" />}
                </button>
                <button onClick={() => auth.signOut()} className="bg-zinc-900 p-4 rounded-2xl"><X size={24} /></button>
              </div>
            </header>

            <main className="flex-1 space-y-10 pt-4">
              <div className={`bg-gradient-to-br ${PROMPTS.find(p => p.id === profile.promptVibe)?.color || PROMPTS[0].color} rounded-[3rem] p-10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/5 space-y-6 text-center transform transition-all`}>
                <div className="w-20 h-20 mx-auto rounded-full border-4 border-white/20 overflow-hidden shadow-xl ring-4 ring-white/10">
                  <img src={profile.photoURL} className="w-full h-full object-cover" />
                </div>
                <div className="space-y-1">
                  <p className="text-white/80 font-black uppercase tracking-widest text-[10px]">@{profile.username}</p>
                  <h3 className="text-2xl font-black leading-tight text-white drop-shadow-md">{profile.currentPrompt}</h3>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between px-2">
                  <p className="text-zinc-500 font-bold text-xs uppercase tracking-widest">Your Private Link</p>
                  <button onClick={copyLink} className="text-purple-500 text-xs font-bold uppercase tracking-wider">{isCopied ? 'Copied!' : 'Copy URL'}</button>
                </div>
                <div className="bg-zinc-900/50 backdrop-blur-md border border-white/5 rounded-[2rem] p-6 flex items-center justify-between group h-20 shadow-inner">
                  <span className="font-bold text-zinc-300 truncate text-lg">jimly.me/{profile.username}</span>
                  <button onClick={handleShare} className="bg-white text-black px-6 py-3 rounded-2xl font-black active:scale-95 transition-all shadow-lg">Share</button>
                </div>
              </div>

              <div className="space-y-4">
                <p className="text-zinc-500 font-bold text-xs uppercase tracking-widest px-2">Vibe Control</p>
                <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
                  {PROMPTS.map(p => (
                    <button 
                      key={p.id}
                      onClick={() => handleUpdatePrompt(p)}
                      className={`flex-shrink-0 w-24 h-24 rounded-[2rem] flex flex-col items-center justify-center gap-1 transition-all border-2 ${profile.promptVibe === p.id ? 'bg-purple-500/10 border-purple-500/50 shadow-[0_0_20px_rgba(168,85,247,0.2)]' : 'bg-zinc-900 border-zinc-800'}`}
                    >
                      <span className="text-2xl">{p.icon}</span>
                      <span className="text-[10px] font-black uppercase text-zinc-400">{p.id}</span>
                    </button>
                  ))}
                </div>
              </div>
            </main>
          </motion.div>
        )}

        {/* INBOX */}
        {view === 'inbox' && (
          <motion.div 
            key="inbox" 
            initial={{ y: '100%', opacity: 0 }} 
            animate={{ y: 0, opacity: 1 }} 
            exit={{ y: '100%', opacity: 0 }} 
            transition={{ type: 'spring', damping: 30, stiffness: 300 }} 
            className="fixed inset-0 bg-zinc-950 z-50 flex flex-col overflow-hidden"
          >
            {/* Ambient Background Glows */}
            <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-600/10 blur-[120px] pointer-events-none" />
            <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] bg-pink-600/10 blur-[120px] pointer-events-none" />

            <div className="p-6 flex items-center justify-between relative z-10">
              <button 
                onClick={() => setView('dashboard')} 
                className="p-3 bg-zinc-900/50 rounded-2xl text-zinc-400 hover:text-white transition-colors border border-white/5 backdrop-blur-md"
              >
                <ArrowLeft size={24} />
              </button>
              <h2 className="text-3xl font-black tracking-tighter italic bg-gradient-to-r from-white to-zinc-500 bg-clip-text text-transparent">Shadow Box</h2>
              <button 
                onClick={generateVibeCheck} 
                disabled={isGeneratingVibe} 
                className="bg-purple-600/20 p-3 rounded-2xl text-purple-400 disabled:opacity-50 border border-purple-500/20 shadow-lg shadow-purple-500/5 backdrop-blur-md active:scale-95 transition-all"
              >
                {isGeneratingVibe ? (
                  <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }}>
                    <Sparkles size={20} />
                  </motion.div>
                ) : (
                  <Sparkles size={20} />
                )}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 pb-32 space-y-8 relative z-10 scrollbar-hide pt-4">
              {vibeCheck && (
                <motion.div 
                  initial={{ scale: 0.9, opacity: 0, y: -20 }} 
                  animate={{ scale: 1, opacity: 1, y: 0 }} 
                  className="bg-gradient-to-br from-purple-600/20 to-pink-600/20 border border-white/10 rounded-[2.5rem] p-8 relative overflow-hidden backdrop-blur-2xl shadow-2xl"
                >
                  <div className="absolute top-2 right-2 p-2 cursor-pointer text-zinc-500 hover:text-white" onClick={() => setVibeCheck(null)}><X size={20} /></div>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="p-2 bg-purple-500 rounded-xl shadow-[0_0_15px_rgba(168,85,247,0.5)]">
                      <Sparkles size={16} className="text-white" />
                    </div>
                    <p className="text-purple-400 font-black uppercase tracking-[0.2em] text-[10px]">AI Vibe Analysis</p>
                  </div>
                  <p className="text-xl font-bold italic leading-tight text-white drop-shadow-sm">"{vibeCheck}"</p>
                </motion.div>
              )}

              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center py-20">
                  <motion.div
                    animate={{ 
                      y: [0, -10, 0],
                      rotate: [0, 5, -5, 0]
                    }}
                    transition={{ repeat: Infinity, duration: 4 }}
                    className="mb-8"
                  >
                    <Ghost size={120} className="text-zinc-800" strokeWidth={1} />
                  </motion.div>
                  <h3 className="text-3xl font-black mb-2 opacity-50">Ghost Town</h3>
                  <p className="text-zinc-500 font-medium max-w-[240px] leading-relaxed">
                    No one has dared to enter your shadows yet. Share your link to start the fire.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-6">
                  <div className="flex items-center justify-between px-2">
                    <p className="text-zinc-500 font-black uppercase tracking-widest text-[10px]">{messages.length} Shadows Unlocked</p>
                    <div className="h-[1px] flex-1 bg-white/5 mx-4" />
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {messages.map((msg, i) => (
                      <motion.div 
                        key={msg.id}
                        initial={{ opacity: 0, y: 30, scale: 0.95 }} 
                        animate={{ opacity: 1, y: 0, scale: 1 }} 
                        transition={{ 
                          delay: i * 0.08,
                          type: 'spring',
                          stiffness: 100,
                          damping: 15
                        }}
                        onClick={() => { setSelectedMessage(msg); setView('message'); }}
                        className={`group relative p-8 rounded-[2.5rem] flex flex-col justify-between text-left transition-all cursor-pointer overflow-hidden border-2 h-56
                          ${msg.status === 'unread' 
                            ? 'bg-zinc-900/80 border-purple-500/50 shadow-[0_10px_30px_rgba(168,85,247,0.1)] ring-1 ring-purple-500/20' 
                            : 'bg-zinc-900/30 border-white/5 opacity-70 hover:opacity-100 hover:bg-zinc-900/50'
                          } backdrop-blur-xl hover:scale-[1.02] active:scale-[0.98]
                        `}
                      >
                        {/* Status Glow */}
                        {msg.status === 'unread' && (
                          <div className="absolute top-[-20%] right-[-10%] w-24 h-24 bg-purple-500/20 blur-3xl pointer-events-none" />
                        )}

                        <div className="relative z-10">
                          {msg.guessWho ? (
                            <div className="flex items-center gap-2 mb-4">
                              <div className="w-8 h-8 bg-purple-600/30 rounded-xl flex items-center justify-center border border-purple-500/30">
                                <Smile size={14} className="text-purple-400" />
                              </div>
                              <span className="text-[10px] font-black uppercase tracking-tighter text-purple-400">Authed Shadow</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 mb-4">
                              <div className="w-8 h-8 bg-zinc-800 rounded-xl flex items-center justify-center border border-white/5">
                                <Ghost size={14} className="text-zinc-500" />
                              </div>
                              <span className="text-[10px] font-black uppercase tracking-tighter text-zinc-500">Deep Shadow</span>
                            </div>
                          )}

                          <p className="text-lg font-bold leading-tight line-clamp-3 italic group-hover:text-white transition-colors">
                            "{msg.content}"
                          </p>
                        </div>

                        <div className="relative z-10 flex items-center justify-between mt-auto">
                          <span className="text-[10px] font-black text-zinc-700 tracking-widest uppercase">#{msg.id.slice(0, 4)}</span>
                          <div className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-zinc-800" />
                            <span className="text-[9px] font-bold text-zinc-600">
                               {msg.createdAt ? new Date(msg.createdAt.seconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Just now'}
                            </span>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Float Menu Nav */}
            <div className="absolute bottom-10 left-0 w-full px-6 pointer-events-none">
              <div className="mx-auto max-w-xs bg-zinc-900/80 backdrop-blur-2xl border border-white/10 rounded-full p-2 flex items-center gap-1 shadow-2xl pointer-events-auto">
                <button 
                  onClick={() => setView('dashboard')}
                  className="flex-1 py-3 px-4 rounded-full flex items-center justify-center gap-2 text-sm font-black transition-all hover:bg-white/5 text-zinc-400"
                >
                  <ArrowLeft size={16} /> Dashboard
                </button>
                <div className="w-[1px] h-6 bg-white/10" />
                <button 
                  onClick={handleShare}
                  className="flex-1 py-3 px-4 bg-white text-black rounded-full flex items-center justify-center gap-2 text-sm font-black transition-all hover:scale-105 active:scale-95"
                >
                  Share Link <Share2 size={16} />
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* MESSAGE DETAIL */}
        {view === 'message' && selectedMessage && (
          <motion.div key="message" initial={{ opacity: 0, scale: 1.1 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="fixed inset-0 bg-black z-[60] flex flex-col p-8 md:p-20">
             <header className="flex justify-between mb-20">
               <button onClick={() => setView('inbox')} className="text-zinc-500"><ArrowLeft size={32} /></button>
               <div className="flex gap-4">
                 <button onClick={() => speakMessage(selectedMessage.content)} className="text-purple-500 p-2 hover:bg-white/10 rounded-full transition-all"><Volume2 size={32} /></button>
                 <button onClick={() => publishToFeed(selectedMessage.content)} className="text-emerald-500 p-2 hover:bg-white/10 rounded-full transition-all"><Share2 size={24} /></button>
                 <button className="text-red-500 p-2 hover:bg-white/10 rounded-full transition-all"><Trash2 size={24} /></button>
               </div>
             </header>
             <main className="flex-1 flex flex-col items-center justify-center space-y-12">
                <p className="text-3xl md:text-5xl font-black italic text-center leading-tight">"{selectedMessage.content}"</p>
                
                <div className="w-full max-w-sm space-y-4">
                  {selectedMessage.guessWho && selectedMessage.guessNames && (
                    <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="bg-purple-600/10 border-2 border-purple-500/30 rounded-[2.5rem] p-6 text-center space-y-6 backdrop-blur-xl relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-full h-1 bg-purple-500/20" />
                      
                      <div className="space-y-1">
                        <p className="text-purple-500 font-black uppercase tracking-[0.2em] text-[10px] flex items-center justify-center gap-2">
                          <Smile size={12} /> Guess Who Mode
                        </p>
                        <h4 className="text-xl font-black">Who sent this?</h4>
                      </div>

                      {selectedMessage.guessResult ? (
                        <div className={`p-6 rounded-2xl flex flex-col items-center gap-4 ${selectedMessage.guessResult === 'correct' ? 'bg-emerald-500/20 border border-emerald-500/30' : 'bg-red-500/20 border border-red-500/30'}`}>
                          {selectedMessage.guessResult === 'correct' ? (
                            <>
                              <div className="w-16 h-16 bg-emerald-500 rounded-full flex items-center justify-center shadow-lg shadow-emerald-500/20">
                                <CheckCircle2 size={32} className="text-white" />
                              </div>
                              <div className="space-y-1">
                                <p className="text-emerald-400 font-black uppercase tracking-widest text-[10px]">U RIGHT! ✅</p>
                                <p className="text-xl font-bold">It was {selectedMessage.senderFirstName}!</p>
                              </div>
                              <button 
                                onClick={() => {
                                  const username = (selectedMessage as any).senderUsername;
                                  if (username) handleSearchProfile(username);
                                }}
                                className="w-full bg-emerald-500 py-4 rounded-xl font-black text-sm text-white shadow-lg shadow-emerald-500/20"
                              >
                                Send a Message Back
                              </button>
                            </>
                          ) : (
                            <>
                              <div className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center shadow-lg shadow-red-500/20">
                                <X size={32} className="text-white" />
                              </div>
                              <div className="space-y-1">
                                <p className="text-red-400 font-black uppercase tracking-widest text-[10px]">U WRONG! ❌</p>
                                <p className="text-zinc-400 font-medium text-sm leading-relaxed">The shadows keep their secret.</p>
                              </div>
                            </>
                          )}
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-3">
                          {selectedMessage.guessNames.map((name) => (
                            <button 
                              key={name}
                              onClick={() => handleGuess(selectedMessage, name)}
                              className="bg-zinc-900 border border-white/5 py-4 rounded-2xl font-black text-xs hover:bg-purple-600 transition-all active:scale-95 shadow-lg"
                            >
                              {name}
                            </button>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  )}
                  
                  <div className="pt-4 space-y-4">
                      <p className="text-zinc-500 font-bold uppercase tracking-widest text-[10px] text-center mb-2 flex items-center justify-center gap-2">
                        <Sparkles size={10} /> AI Deep Hint
                      </p>
                      <div className="bg-zinc-900/50 border border-white/5 rounded-3xl p-6 text-center backdrop-blur-md">
                        {selectedMessage.hint ? (
                          <p className="text-lg font-bold text-purple-400 italic">"{selectedMessage.hint}"</p>
                        ) : (
                          <button onClick={() => generateHint(selectedMessage)} className="w-full bg-white text-black py-4 rounded-2xl font-black shadow-xl">Get AI Hint 🎭</button>
                        )}
                      </div>
                  </div>
                </div>
             </main>
             <footer className="mt-auto">
               <button onClick={() => setView('inbox')} className="w-full bg-zinc-900 py-5 rounded-3xl font-black text-xl">Back to Shadow Box</button>
             </footer>
          </motion.div>
        )}

        {/* GLOBAL FEED */}
        {view === 'feed' && (
          <motion.div key="feed" initial={{ x: -100, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 100, opacity: 0 }} className="h-screen flex flex-col bg-zinc-950">
            <header className="p-6 flex items-center justify-between border-b border-white/5">
              <button onClick={() => setView(user ? 'dashboard' : 'landing')} className="text-zinc-500"><ArrowLeft size={28} /></button>
              <h2 className="text-2xl font-black italic bg-gradient-to-br from-purple-500 to-pink-500 bg-clip-text text-transparent">jimly global</h2>
              <div className="w-7"/>
            </header>
            <main className="flex-1 overflow-y-auto p-6 space-y-4">
              <p className="text-zinc-500 font-bold uppercase tracking-widest text-[10px] text-center mb-6">Latest Shadows around the world</p>
              {feedMessages.map((msg, i) => (
                <motion.div 
                  key={msg.id} 
                  initial={{ opacity: 0, scale: 0.9 }} 
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.05 }}
                  className="bg-zinc-900/50 border border-white/5 rounded-3xl p-8 shadow-xl"
                >
                  <p className="text-xl font-bold italic leading-tight mb-4">"{msg.content}"</p>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-700 text-[10px] font-black uppercase tracking-widest">#{msg.id.slice(0, 4)}</span>
                    <div className="flex items-center gap-4 text-zinc-500">
                       <button 
                        onClick={() => handleLike(msg.id, msg.likes)} 
                        className="flex items-center gap-1 hover:text-pink-500 transition-colors active:scale-125"
                       >
                        ❤️ {msg.likes || 0}
                       </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </main>
            <footer className="p-6">
               {!user && (
                 <button onClick={handleLogin} className="w-full bg-purple-600 py-4 rounded-2xl font-black shadow-lg shadow-purple-600/20">Sign in to Post</button>
               )}
            </footer>
          </motion.div>
        )}

        {/* PUBLIC PROFILE */}
        {view === 'profile' && targetUser && (
          <motion.div key="profile" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-h-screen flex flex-col items-center justify-center p-6 bg-zinc-950">
            {user && (
              <header className="fixed top-0 left-0 w-full p-6 flex justify-between items-center z-10">
                <button onClick={() => setView('dashboard')} className="text-zinc-500 flex items-center gap-2 font-bold px-4 py-2 bg-zinc-900/50 rounded-xl backdrop-blur-md border border-white/5"><ArrowLeft size={18} /> My Link</button>
              </header>
            )}
            <AnimatePresence mode="wait">
              {isSent ? (
                <motion.div 
                  key="success"
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="w-full max-w-sm flex flex-col items-center text-center space-y-10"
                >
                   <div className="w-24 h-24 bg-emerald-500 rounded-full flex items-center justify-center shadow-[0_0_50px_rgba(16,185,129,0.4)]">
                     <CheckCircle2 size={48} className="text-white" />
                   </div>
                   <div className="space-y-3">
                     <h2 className="text-4xl font-black italic">Sent!</h2>
                     <p className="text-zinc-500 font-medium">Your shadow message has been delivered.</p>
                   </div>
                   
                   <div className="w-full space-y-4">
                     <button 
                        onClick={() => {
                          if (user) setView('dashboard');
                          else handleLogin();
                        }}
                        className="w-full bg-white text-black py-5 rounded-[2rem] font-black text-xl hover:scale-105 transition-all shadow-xl"
                     >
                       Create your Jimly
                     </button>
                     <button 
                      onClick={() => setIsSent(false)}
                      className="w-full bg-zinc-900 border border-white/5 py-4 rounded-[2rem] font-bold text-zinc-400"
                     >
                       Send another message
                     </button>
                   </div>
                   <p className="text-zinc-700 text-[10px] font-black uppercase tracking-[0.2em] italic">PowerED BY JIMLY <Ghost size={12}/></p>
                </motion.div>
              ) : (
                <motion.div 
                  key="form"
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  className="w-full max-w-sm space-y-8 flex flex-col items-center"
                >
                   <div className={`w-full bg-gradient-to-br ${PROMPTS.find(p => p.id === targetUser.promptVibe)?.color || PROMPTS[0].color} rounded-[3rem] p-10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/10 flex flex-col items-center gap-6 relative`}>
                      <div className="w-20 h-20 rounded-full border-4 border-white/20 overflow-hidden shadow-xl ring-4 ring-white/10">
                        <img src={targetUser.photoURL} className="w-full h-full object-cover" />
                      </div>
                      <div className="text-center space-y-2 text-white">
                        <p className="font-black uppercase tracking-widest text-[10px] opacity-60">@{targetUser.username}</p>
                        <h2 className="text-3xl font-black leading-tight drop-shadow-md">{targetUser.currentPrompt || "Send me anonymous messages!"}</h2>
                      </div>
                   </div>

                   <div className="w-full bg-zinc-900/50 backdrop-blur-xl border border-white/5 rounded-[3rem] p-8 shadow-2xl space-y-6">
                      <div className="flex items-center justify-between bg-zinc-800/50 p-4 rounded-2xl border border-white/5">
                        <div className="flex items-center gap-3">
                          <Smile className="text-purple-500" size={24} />
                          <div className="text-left">
                            <p className="text-sm font-bold">Guess Who Mode</p>
                            <p className="text-[10px] text-zinc-500 font-medium leading-none">Receiver can see your profile</p>
                          </div>
                        </div>
                        <button 
                          onClick={() => {
                            if (!user && !guessWho) {
                              handleLogin();
                            } else {
                              setGuessWho(!guessWho);
                            }
                          }}
                          className={`w-14 h-8 rounded-full relative transition-all duration-300 ${guessWho ? 'bg-purple-600' : 'bg-zinc-700'}`}
                        >
                          <div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all shadow-md ${guessWho ? 'left-7' : 'left-1'}`} />
                        </button>
                      </div>
                      <textarea id="msg" placeholder="Type here..." className="w-full h-40 bg-transparent text-white border-2 border-zinc-800 rounded-[2rem] p-6 focus:border-purple-500 outline-none resize-none font-bold text-xl placeholder-zinc-700 transition-all" />
                      <button onClick={() => { const el = document.getElementById('msg') as HTMLTextAreaElement; handleSendMessage(el.value); el.value = ''; }} className="w-full bg-white text-black font-black py-5 rounded-[2rem] text-xl shadow-xl hover:scale-[1.02] active:scale-95 transition-all">Send!</button>
                   </div>
                   <p className="text-zinc-700 text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-2 italic">POwerED BY JIMLY <Ghost size={12}/></p>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
