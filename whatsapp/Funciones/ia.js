const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function analizarDocumentoIA(textoDocumento) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const textoRecortado = textoDocumento;
        
        const prompt = `Actúa como SmartPathAI, un tutor inteligente. 
        A continuación, te proporciono el texto extraído de un documento de estudio. 
        Tu tarea es leerlo y generar un resumen MUY BREVE (máximo 3 viñetas o bullet points) sobre los conceptos clave que contiene. 
        Usa un tono amigable, no incluyas emojis.
        
        Texto del documento:
        ${textoRecortado}`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error("Error al analizar documento:", error);
        return "El documento fue guardado, pero hubo un problema analizándolo con IA.";
    }
}

module.exports = { genAI, analizarDocumentoIA };