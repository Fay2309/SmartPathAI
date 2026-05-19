module.exports = {
    execute: async (msg, numeroLimpio, usuarioBD, estadoUsuariosActivos, pool) => {
        try {
            const [disciplinas] = await pool.execute('SELECT id_disciplina, nombre_disciplina FROM disciplina');

            if (disciplinas.length === 0) {
                await msg.reply('Bot: Por el momento no hay áreas de estudio registradas en el sistema.');
                return;
            }

            let menuDisciplinas = `Bot: ¿A qué nueva área de estudio te gustaría cambiarte? *(Responde solo con el número o escribe *cancelar*)*:\n\n`;
            disciplinas.forEach(d => { 
                menuDisciplinas += `${d.id_disciplina}. ${d.nombre_disciplina}\n`; 
            });
            estadoUsuariosActivos[numeroLimpio] = { paso: 'ESPERANDO_NUEVA_DISCIPLINA' };
            await msg.reply(menuDisciplinas);

        } catch (error) {
            console.error('Error en comando !disciplina:', error);
            await msg.reply('Bot: Hubo un error al cargar las áreas de estudio. Intenta nuevamente.');
        }
    }
};