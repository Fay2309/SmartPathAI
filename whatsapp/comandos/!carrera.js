module.exports = {
    execute: async (msg, numeroLimpio, usuarioBD, estadoUsuariosActivos, pool) => {
        try {
            const [carreraInfo] = await pool.execute(
                'SELECT id_disciplina FROM carrera WHERE id_carrera = ?',
                [usuarioBD.id_carrera]
            );

            if (carreraInfo.length === 0) {
                await msg.reply('Bot: Hubo un problema al encontrar tu área de estudio actual. Intenta más tarde.');
                return;
            }

            const idDisciplina = carreraInfo[0].id_disciplina;
            const [carreras] = await pool.execute(
                'SELECT id_carrera, nombre_carrera FROM carrera WHERE id_disciplina = ?',
                [idDisciplina]
            );

            if (carreras.length === 0) {
                await msg.reply('Bot: Parece que no hay otras carreras registradas en tu área.');
                return;
            }
            let menuCarreras = `Bot: Aquí tienes las carreras de tu área actual. ¿A cuál te quieres cambiar? *(Responde solo con el número o escribe *cancelar*)*:\n\n`;
            carreras.forEach(c => { 
                menuCarreras += `${c.id_carrera}. ${c.nombre_carrera}\n`; 
            });
            estadoUsuariosActivos[numeroLimpio] = { paso: 'ESPERANDO_NUEVA_CARRERA' };
            await msg.reply(menuCarreras);

        } catch (error) {
            console.error('Error en comando !carrera:', error);
            await msg.reply('Bot: Hubo un error al cargar las carreras. Intenta nuevamente.');
        }
    }
};