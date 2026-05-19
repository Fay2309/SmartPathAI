module.exports = {
    execute: async (msg, numeroLimpio, usuarioBD, estadoUsuariosActivos, pool) => {
        try {
            if (usuarioBD.activo === 0) {
                await msg.reply('El sistema ya se encontraba desactivado para tu cuenta.');
                return;
            }

            await pool.execute('UPDATE usuario SET activo = 0 WHERE numero_telefono = ?', [numeroLimpio]);

            if (estadoUsuariosActivos[numeroLimpio]) {
                if (estadoUsuariosActivos[numeroLimpio].temporizador) {
                    clearTimeout(estadoUsuariosActivos[numeroLimpio].temporizador);
                }
                delete estadoUsuariosActivos[numeroLimpio];
            }

            await msg.reply('🔇 *Bot Desactivado*\n\nHe pausado todas tus notificaciones. Ya no recibirás píldoras diarias, recordatorios, ni responderé a tus mensajes o archivos.\n\nCuando desees volver a estudiar, simplemente escribe *!reanudar*.');
        } catch (error) {
            console.error('Error al desactivar el bot:', error);
            await msg.reply('Hubo un problema al intentar desactivar el bot.');
        }
    }
};