const { obtenerRango } = require('../Funciones/utils'); 

module.exports = {
    execute: async (msg, numeroLimpio, usuarioBD, estadoUsuariosActivos, pool) => {
        try {
            const [rows] = await pool.execute(
                'SELECT puntos_experiencia, racha_actual, racha_maxima, nivel_conocimiento FROM usuario WHERE numero_telefono = ?',
                [numeroLimpio]
            );

            if (rows.length === 0) {
                await msg.reply('Bot: Hubo un error al buscar tu progreso en la base de datos.');
                return;
            }

            const datos = rows[0];
            const rangoActual = obtenerRango(datos.puntos_experiencia);

            let tarjeta = `📊 *Tu Perfil de SmartPathAI* 📊\n\n`;
            tarjeta += `👤 *Estudiante:* ${usuarioBD.nombre}\n`;
            tarjeta += `🧠 *Nivel Diagnóstico:* ${datos.nivel_conocimiento}\n`;
            tarjeta += `🏆 *Liga Actual:* ${rangoActual}\n`;
            tarjeta += `✨ *Experiencia:* ${datos.puntos_experiencia} pts\n`;
            tarjeta += `🔥 *Racha Activa:* ${datos.racha_actual} días\n`;
            tarjeta += `👑 *Racha Máxima:* ${datos.racha_maxima} días\n\n`;
            
            if (datos.racha_actual === 0) {
                tarjeta += `_¡Aún estás a tiempo! Contesta tu píldora de hoy para encender tu racha._`;
            } else if (datos.racha_actual < 10) {
                tarjeta += `_¡Vas muy bien! Recuerda que al llegar a los 10 días seguidos empezarás a ganar más puntos por acierto._`;
            } else {
                tarjeta += `_¡Estás imparable! Tienes el bono de racha activado. No dejes que el fuego se apague._`;
            }

            await msg.reply(tarjeta);

        } catch (error) {
            console.error('Error en el comando !progreso:', error);
            await msg.reply('Bot: Lo siento, tuve un problema al cargar tus estadísticas. Por favor intenta en unos minutos.');
        }
    }
};