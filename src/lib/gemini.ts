import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function getMessageVibe(messages: string[]) {
  if (messages.length === 0) return "Silence... Share your link to start the fire! 🔥";
  
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite-preview",
      contents: `Analyze these anonymous messages and give a 1-sentence "Vibe Check" or "Roast". Be witty, slightly edgy, and use emojis. 
      Messages: ${messages.join(' | ')}`,
    });
    return response.text || "Just vibes...";
  } catch (e) {
    console.error(e);
    return "The vibes are too strong for the AI right now.";
  }
}

export async function getMessageHint(message: string) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite-preview",
      contents: `Give a funny, non-revealing "AI Hint" about who sent this message: "${message}". 
      Example: "Someone who definitely uses Dark Mode" or "A person who probably drinks oat milk". 
      Keep it short and playful.`,
    });
    return response.text || "A mystery person...";
  } catch (e) {
    console.error(e);
    return "A local legend...";
  }
}

export async function checkToxicity(message: string): Promise<boolean> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite-preview",
      contents: `Is the following message toxic, bullying, or hate speech? Answer with only "true" or "false".
      Message: "${message}"`,
    });
    return response.text.toLowerCase().includes('true');
  } catch (e) {
    console.error(e);
    return false; // Default to allowing if AI fails
  }
}
