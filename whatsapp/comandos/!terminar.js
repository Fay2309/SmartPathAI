module.exports = {
    execute: async (msg, numeroLimpio, usuarioBD, estadoUsuariosActivos, pool) => {
        const sesion = estadoUsuariosActivos[numeroLimpio];

        if (!sesion || sesion.paso !== 'ESPERANDO_RESPUESTA_SESION') {
            await msg.reply('No tienes ninguna sesión de estudio activa en este momento.');
            return;
        }

        try {
            await pool.execute(
                'UPDATE interaccion_estudio SET estado = "COMPLETADO", fecha_completado = NOW() WHERE id_interaccion = ?',
                [sesion.id_sesion_db]
            );

            delete estadoUsuariosActivos[numeroLimpio];
            await msg.reply(`¡Sesión terminada! Espero que el repaso de *"${sesion.tema}"* te haya servido. ¡Nos vemos en la próxima!`);
        } catch (error) {
            console.error('Error al terminar sesión:', error);
            await msg.reply('Tuve un error al cerrar la sesión en la base de datos, pero ya limpié tu estado actual.');
            delete estadoUsuariosActivos[numeroLimpio];
        }
    }
};