module.exports = {
    execute: async (msg, numeroLimpio, usuarioBD, estadoUsuariosActivos, pool) => {
        const sesion = estadoUsuariosActivos[numeroLimpio];

        if (!estadoUsuariosActivos[numeroLimpio] || (estadoUsuariosActivos[numeroLimpio].paso !== 'ESPERANDO_RESPUESTA_SESION' && estadoUsuariosActivos[numeroLimpio].paso !== 'PROCESANDO_VOTO')) {
            await msg.reply('Actualmente no tienes ninguna sesión de estudio activa.');
            return;
        }

        try {
            if (sesion.temporizador) {
                clearTimeout(sesion.temporizador);
            }

            await pool.execute(
                'UPDATE interaccion_estudio SET estado = "COMPLETADO", fecha_completado = NOW() WHERE id_interaccion = ?',
                [sesion.id_sesion_db]
            );

            delete estadoUsuariosActivos[numeroLimpio];
            await msg.reply(`¡Sesión terminada! Espero que el repaso de *"${sesion.tema}"* te haya servido. ¡Nos vemos en la próxima!`);
        } catch (error) {
            console.error('Error al terminar sesión:', error);
            await msg.reply('Tuve un error al cerrar la sesión en la base de datos, pero ya limpié tu estado actual.');

            if (sesion && sesion.temporizador) {
                clearTimeout(sesion.temporizador);
            }
            delete estadoUsuariosActivos[numeroLimpio];
        }
    }
};