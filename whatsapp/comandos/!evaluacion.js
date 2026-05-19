module.exports = {
    execute: async (msg, numeroLimpio, usuarioBD, estadoUsuariosActivos, pool, genAI, hacerPreguntaDiagnostico) => {
        try {
            const [info] = await pool.execute(`
                SELECT c.id_carrera, c.nombre_carrera, d.id_disciplina, d.nombre_disciplina
                FROM carrera c
                JOIN disciplina d ON c.id_disciplina = d.id_disciplina
                WHERE c.id_carrera = ?
            `, [usuarioBD.id_carrera]);

            if (info.length === 0) {
                await msg.reply('Bot: Hubo un error buscando la información de tu carrera en la base de datos.');
                return;
            }

            const { id_disciplina, nombre_disciplina, nombre_carrera } = info[0];

            await msg.reply(`¡Excelente iniciativa, ${usuarioBD.nombre}! Vamos a poner a prueba tus conocimientos en *${nombre_carrera}*.\n\nTe haré 3 preguntas para recalcular tu nivel actual. Generando la primera pregunta...`);
            
            const chat = await msg.getChat();
            chat.sendStateTyping();

            await hacerPreguntaDiagnostico(numeroLimpio, msg.from, info[0].id_carrera, nombre_carrera, 'Principiante', 1, 0);

        } catch (error) {
            console.error('Error en el comando !evaluacion:', error);
            await msg.reply('Bot: Hubo un problema al intentar iniciar la evaluación. Por favor, intenta de nuevo más tarde.');
        }
    }
};