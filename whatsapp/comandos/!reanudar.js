module.exports = {
    execute: async (msg, numeroLimpio, usuarioBD, estadoUsuariosActivos, pool) => {
        try {
            if (usuarioBD.activo === 1) {
                await msg.reply('El sistema ya está activo. ¡Sigamos estudiando!');
                return;
            }

            await pool.execute('UPDATE usuario SET activo = 1 WHERE numero_telefono = ?', [numeroLimpio]);

            await msg.reply('🔊 *Bot Reanudado*\n\n¡Qué bueno tenerte de vuelta! Tus píldoras y recordatorios volverán a funcionar con normalidad.\n\nEscribe *!ayuda* si necesitas recordar los comandos.');
        } catch (error) {
            console.error('Error al reanudar el bot:', error);
        }
    }
};