module.exports = {
    execute: async (msg, numeroLimpio, usuarioBD, estadoUsuariosActivos) => {
        try {
            const horaActualBD = usuarioBD.hora_pildora.substring(0, 5); 
            await msg.reply(`Bot: Tu píldora diaria está programada a las *${horaActualBD}*.\n\nSi deseas cambiarla, responde a este mensaje con la nueva hora en formato 24h (ejemplo: 14:30).\n\nSi no quieres cambiarla, escribe *cancelar*.`);
            estadoUsuariosActivos[numeroLimpio] = { paso: 'ESPERANDO_NUEVA_HORA' };
            
        } catch (error) {
            console.error('Error en el comando !horapildora:', error);
            await msg.reply('Bot: Hubo un error al consultar tu hora. Intenta de nuevo.');
        }
    }
};