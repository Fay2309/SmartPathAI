module.exports = {
    execute: async (msg, numeroLimpio, usuarioBD, estadoUsuariosActivos, pool) => {
        try {
            const [temas] = await pool.execute(
                'SELECT DISTINCT tema_o_archivo FROM interaccion_estudio WHERE id_usuario = ?',
                [usuarioBD.id_usuario]
            );

            if (temas.length === 0) {
                await msg.reply('Aún no tienes archivos registrados. Envíame un PDF o Word primero.');
                return;
            }

            let menuTemas = `*¿Qué te gustaría repasar hoy?* \n\nResponde con el *número* del tema:\n\n`;
            temas.forEach((t, index) => {
                menuTemas += `${index + 1}. ${t.tema_o_archivo}\n`;
            });
            menuTemas += `\n_Escribe "cancelar" para salir._`;

            estadoUsuariosActivos[numeroLimpio] = { 
                paso: 'ESPERANDO_ELECCION_TEMA',
                listaTemas: temas.map(t => t.tema_o_archivo) 
            };

            await msg.reply(menuTemas);
        } catch (error) {
            console.error('Error en !sesion:', error);
            await msg.reply('Error al cargar tus temas.');
        }
    }
};