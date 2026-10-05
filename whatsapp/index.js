require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js'); // Librería para interactuar con WhatsApp Web [PRINCIPAL] - Añadir POLL luego
const qrcode = require('qrcode-terminal'); // Para generar el código QR en la terminal
const fs = require('fs');
const pdf = require('pdf-parse'); // Para extraer texto de PDFs
const mammoth = require('mammoth'); // Para extraer texto de archivos DOCX
const cron = require('node-cron');

const pool = require('./Funciones/db');
const { genAI, analizarDocumentoIA } = require('./Funciones/ia');
const { calcularProgresion, obtenerRango, registrarInteraccion } = require('./Funciones/utils');

const comandos = {
    '!horapildora': require('./comandos/!horapildora'),
    '!carrera': require('./comandos/!carrera'),
    '!disciplina': require('./comandos/!disciplina'),
    '!sesion': require('./comandos/!sesion'),
    '!terminar': require('./comandos/!terminar'),
    '!evaluacion': require('./comandos/!evaluacion'),
    '!generarpildoras': require('./comandos/!generarpildoras'),
    '!progreso': require('./comandos/!progreso'),
    '!desactivar': require('./comandos/!desactivar'),
    '!reanudar': require('./comandos/!reanudar')
};

const usuariosEnRegistro = {};
const estadoUsuariosActivos = {};
async function resolverNumeroReal(identificador, contacto) {
    const dominio = identificador.split('@')[1];
    const idSinDominio = identificador.split('@')[0];
    if (dominio === 'c.us') {
        const numero = idSinDominio.split(':')[0];
        return numero;
    }

    if (contacto && contacto.id && contacto.id.user && contacto.id._serialized && contacto.id._serialized.includes('@c.us')) {
        const numeroReal = contacto.id.user;
        return numeroReal;
    }
    try {
        const [rows] = await pool.execute(
            'SELECT numero_telefono FROM usuario WHERE lid_whatsapp = ?',
            [identificador]
        );
        if (rows.length > 0) {
            return rows[0].numero_telefono;
        }
    } catch (e) { }

    const numeroFallback = idSinDominio.split(':')[0];
    return numeroFallback;
}

const pasosRegistro = {
    'INICIO': async (msg, numeroLimpio) => {
        usuariosEnRegistro[numeroLimpio] = { paso: 'ESPERANDO_NOMBRE' };
        await msg.reply('¡Hola! Veo que eres nuevo por aquí. Soy *SmartPathAI*, tu tutor inteligente.\n\nPara poder personalizar tu experiencia, necesito unos datos rápidos.\n\n¿Cómo te gustaría que te llame?');
    },

    'ESPERANDO_NOMBRE': async (msg, numeroLimpio, textoUsuario) => {
        usuariosEnRegistro[numeroLimpio].nombre = textoUsuario;
        usuariosEnRegistro[numeroLimpio].paso = 'ESPERANDO_DISCIPLINA';

        const [disciplinas] = await pool.execute('SELECT id_disciplina, nombre_disciplina FROM disciplina');
        let menuDisciplinas = `¡Mucho gusto, ${textoUsuario}! \n\nPara adaptar tu tutoría, ¿a qué área de estudio perteneces? *(Responde solo con el número)*:\n\n`;
        disciplinas.forEach(d => { menuDisciplinas += `${d.id_disciplina}. ${d.nombre_disciplina}\n`; });
        await msg.reply(menuDisciplinas);
    },

    'ESPERANDO_DISCIPLINA': async (msg, numeroLimpio, textoUsuario) => {
        const idDisciplina = parseInt(textoUsuario);
        const [disciplinaValida] = await pool.execute('SELECT id_disciplina, nombre_disciplina FROM disciplina WHERE id_disciplina = ?', [idDisciplina]);

        if (isNaN(idDisciplina) || disciplinaValida.length === 0) {
            await msg.reply('Por favor, ingresa un número válido de la lista anterior.');
            return;
        }

        const [carreras] = await pool.execute('SELECT id_carrera, nombre_carrera FROM carrera WHERE id_disciplina = ?', [idDisciplina]);
        if (carreras.length === 0) {
            await msg.reply('Ups, parece que aún no hay carreras registradas en esta área. Por favor intenta con otra.');
            return;
        }

        usuariosEnRegistro[numeroLimpio].id_disciplina = idDisciplina;
        usuariosEnRegistro[numeroLimpio].nombre_disciplina = disciplinaValida[0].nombre_disciplina;

        usuariosEnRegistro[numeroLimpio].paso = 'ESPERANDO_CARRERA';
        let menuCarreras = `Excelente elección. Ahora, selecciona tu carrera *(Responde solo con el número)*:\n\n`;
        carreras.forEach(c => { menuCarreras += `${c.id_carrera}. ${c.nombre_carrera}\n`; });
        await msg.reply(menuCarreras);
    },

    'ESPERANDO_CARRERA': async (msg, numeroLimpio, textoUsuario) => {
        const idCarrera = parseInt(textoUsuario);
        const [carreraValida] = await pool.execute('SELECT id_carrera, nombre_carrera FROM carrera WHERE id_carrera = ?', [idCarrera]);

        if (isNaN(idCarrera) || carreraValida.length === 0) {
            await msg.reply('Por favor, ingresa un número válido de la lista de carreras.');
            return;
        }

        usuariosEnRegistro[numeroLimpio].id_carrera = idCarrera;
        usuariosEnRegistro[numeroLimpio].nombre_carrera = carreraValida[0].nombre_carrera;
        usuariosEnRegistro[numeroLimpio].paso = 'ESPERANDO_HORA';
        await msg.reply(`¡Perfecto! Ya casi terminamos.\n\nTodos los días te enviaré una "Píldora de Conocimiento" para ayudarte a estudiar.\n\n¿A qué hora prefieres recibirla? (Por favor, responde en formato de 24 horas, por ejemplo: *07:00* o *16:30*).`);
    },

    'ESPERANDO_HORA': async (msg, numeroLimpio, textoUsuario) => {
        const regexHora = /^([01]\d|2[0-3]):([0-5]\d)$/;
        if (!regexHora.test(textoUsuario)) {
            await msg.reply('Ese formato de hora no parece correcto. Por favor, intenta de nuevo usando el formato HH:MM (ejemplo: 08:00).');
            return;
        }

        const { nombre, id_carrera, id_disciplina, nombre_disciplina, nombre_carrera } = usuariosEnRegistro[numeroLimpio];

        await pool.execute(
            'INSERT INTO usuario (id_carrera, nombre, numero_telefono, hora_pildora, fecha_registro, nivel_conocimiento, diagnostico_completo) VALUES (?, ?, ?, ?, NOW(), "Principiante", 0)',
            [id_carrera, nombre, numeroLimpio, textoUsuario]
        );

        delete usuariosEnRegistro[numeroLimpio];

        await msg.reply(`¡Excelente! Tu registro está completo y configuré tus píldoras para las *${textoUsuario}*.\n\nPara poder personalizar tu experiencia, haremos una pequeña prueba de 3 preguntas para calcular tu nivel actual en *${nombre_carrera}*.\n\nGenerando tu primera pregunta...`);

        try {
            const chat = await msg.getChat();
            chat.sendStateTyping();
        } catch (e) { }
        await hacerPreguntaDiagnostico(numeroLimpio, `${numeroLimpio}@c.us`, id_carrera, nombre_carrera, 'Principiante', 1, 0);
    }
};

function crearTemporizadorSesion(numeroLimpio, chatId, idSesionDB) {
    return setTimeout(async () => {
        try {
            if (estadoUsuariosActivos[numeroLimpio] && estadoUsuariosActivos[numeroLimpio].id_sesion_db === idSesionDB) {

                await pool.execute(
                    'UPDATE interaccion_estudio SET estado = "COMPLETADO", fecha_completado = NOW() WHERE id_interaccion = ?',
                    [idSesionDB]
                );
                await client.sendMessage(chatId, 'Tu sesión ha terminado automáticamente por inactividad. ¡Escribe *!sesion* cuando quieras volver a repasar!');
                delete estadoUsuariosActivos[numeroLimpio];
            }
        } catch (error) {
            console.error('Error cerrando sesión por inactividad:', error);
        }
    }, 15 * 60 * 1000);
}

async function hacerPreguntaDiagnostico(numeroLimpio, chatId, id_carrera, nombre_carrera, dificultad, numPregunta, puntajeActual) {
    try {
        const [pildoras] = await pool.execute(
            'SELECT cuerpo_texto FROM pildora WHERE id_carrera = ? AND dificultad = ? ORDER BY RAND() LIMIT 1',
            [id_carrera, dificultad]
        );

        let textoReferencia = pildoras.length > 0 ? pildoras[0].cuerpo_texto : `Conceptos fundamentales, técnicos y específicos de la carrera universitaria ${nombre_carrera}`;

        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const prompt = `Actúa como un profesor universitario evaluando los conocimientos previos de un alumno de ${nombre_carrera}.
        Utiliza esta información como TU FUENTE DE VERDAD SECRETA para formular la pregunta: "${textoReferencia}"

        Genera UNA pregunta de opción múltiple de nivel *${dificultad}* con 4 opciones.
        
        REGLAS DE FORMATO CRÍTICAS:
        1. Devuelve ÚNICAMENTE un objeto JSON válido.
        2. NO incluyas markdown, ni comillas invertidas, ni la palabra "json".
        3. Las opciones deben ser breves (máximo 60 caracteres cada una).
        4. Sigue esta estructura exacta:
        {
            "pregunta": "El texto de la pregunta",
            "opciones": ["Opción A", "Opción B", "Opción C", "Opción D"],
            "respuesta_correcta": "El texto exacto de la opción correcta (debe coincidir con una del array)"
        }`;

        const result = await model.generateContent(prompt);
        let textoIA = await result.response.text();
        textoIA = textoIA.replace(/```json/gi, '').replace(/```/gi, '').trim();
        const datosPregunta = JSON.parse(textoIA);
        const opcionesUnicas = [...new Set(datosPregunta.opciones)];

        if (opcionesUnicas.length < 2) {
            opcionesUnicas.push("Opción no disponible", "Contactar soporte");
        }

        let mensajePregunta =
            `*Pregunta ${numPregunta}/3 (Nivel: ${dificultad})*\n\n` +
            `${datosPregunta.pregunta}\n\n`;

        opcionesUnicas.forEach((opcion, index) => {
            mensajePregunta += `*${index + 1}.* ${opcion}\n`;
        });

        mensajePregunta += `\n_Responde únicamente con el número de la opción._`;

        estadoUsuariosActivos[numeroLimpio] = {
            paso: 'EVALUANDO_DIAGNOSTICO',
            id_carrera: id_carrera,
            nombre_carrera: nombre_carrera,
            dificultad_actual: dificultad,
            numero_pregunta: numPregunta,
            pregunta_actual: datosPregunta.pregunta,
            opciones_actuales: opcionesUnicas,
            respuesta_correcta: datosPregunta.respuesta_correcta,
            puntaje: puntajeActual,
        };

        await client.sendMessage(chatId, mensajePregunta);

    } catch (error) {
        console.error('Error generando pregunta de diagnóstico:', error);
        await client.sendMessage(chatId, 'Hubo un error al cargar tu evaluación. Escribe *cancelar* y continuemos.');
    }
}

async function procesarRespuestaOpcion(
    numeroLimpio,
    chatId,
    opcionElegida
) {
    const sesion = estadoUsuariosActivos[numeroLimpio];

    if (!sesion) return;

    const flujoActual = sesion.paso;

    estadoUsuariosActivos[numeroLimpio].paso = 'PROCESANDO_RESPUESTA';

    if (sesion.temporizador) {
        clearTimeout(sesion.temporizador);
    }

    const esCorrecto =
        opcionElegida === sesion.respuesta_correcta;

    const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash'
    });

    /*
     * ========================================
     * DIAGNÓSTICO
     * ========================================
     */
    if (flujoActual === 'EVALUANDO_DIAGNOSTICO') {

        const promptEval = `
Actúa como un tutor evaluando a un alumno.

Pregunta: "${sesion.pregunta_actual}"
El alumno seleccionó: "${opcionElegida}"
La respuesta correcta era: "${sesion.respuesta_correcta}"

Explica brevemente por qué es ${esCorrecto ? 'correcta' : 'incorrecta'
            } de manera motivadora (sin emojis).
`;

        const resEval = await model.generateContent(promptEval);
        const feedback = await resEval.response.text();

        if (esCorrecto) {
            sesion.puntaje += 1;
        }

        await client.sendMessage(
            chatId,
            feedback.trim()
        );

        if (sesion.numero_pregunta === 1) {

            await hacerPreguntaDiagnostico(
                numeroLimpio,
                chatId,
                sesion.id_carrera,
                sesion.nombre_carrera,
                'Intermedio',
                2,
                sesion.puntaje
            );

        } else if (sesion.numero_pregunta === 2) {

            await hacerPreguntaDiagnostico(
                numeroLimpio,
                chatId,
                sesion.id_carrera,
                sesion.nombre_carrera,
                'Avanzado',
                3,
                sesion.puntaje
            );

        } else {

            let nivelFinal = 'Principiante';

            if (sesion.puntaje === 2) {
                nivelFinal = 'Intermedio';
            }

            if (sesion.puntaje === 3) {
                nivelFinal = 'Avanzado';
            }

            await pool.execute(
                `UPDATE usuario
                 SET nivel_conocimiento = ?,
                     diagnostico_completo = 1
                 WHERE numero_telefono = ?`,
                [nivelFinal, numeroLimpio]
            );

            await client.sendMessage(
                chatId,
                `*¡Diagnóstico Completado!*

Lograste ${sesion.puntaje} de 3 aciertos.

He configurado tu nivel en la carrera de ${sesion.nombre_carrera} como: *${nivelFinal}*.

¡Ya puedes enviarme tus documentos para comenzar a estudiar o escribir *!ayuda* para ver mis comandos!`
            );

            delete estadoUsuariosActivos[numeroLimpio];
        }

        return;
    }

    /*
     * ========================================
     * SESIÓN DE ESTUDIO
     * ========================================
     */

    if (flujoActual === 'ESPERANDO_RESPUESTA_SESION') {

        const [rows] = await pool.execute(
            'SELECT * FROM usuario WHERE numero_telefono = ?',
            [numeroLimpio]
        );

        if (rows.length === 0) return;

        const usuarioBD = rows[0];

        const promptEval = `
Actúa como un tutor empático.

La pregunta era: "${sesion.pregunta_actual}"
El estudiante seleccionó: "${opcionElegida}"
La respuesta correcta era: "${sesion.respuesta_correcta}"

Explícale brevemente y de forma constructiva por qué su elección es ${esCorrecto ? 'correcta' : 'incorrecta'
            }.

No uses emojis.
`;

        const resEval = await model.generateContent(promptEval);
        const feedbackLimpio = await resEval.response.text();

        if (sesion.origen === 'PROGRAMADO_DIARIO') {

            const {
                nuevoPuntaje,
                nuevaRacha,
                puntosCambiados
            } = calcularProgresion(
                usuarioBD.puntos_experiencia,
                usuarioBD.racha_actual,
                esCorrecto
            );

            const nuevoRango = obtenerRango(nuevoPuntaje);

            const rangoAnterior =
                obtenerRango(usuarioBD.puntos_experiencia);

            let rachaMax = usuarioBD.racha_maxima;

            if (nuevaRacha > rachaMax) {
                rachaMax = nuevaRacha;
            }

            await pool.execute(
                `UPDATE usuario
                 SET puntos_experiencia = ?,
                     racha_actual = ?,
                     racha_maxima = ?,
                     fecha_ultima_pildora_correcta = NOW()
                 WHERE numero_telefono = ?`,
                [
                    nuevoPuntaje,
                    nuevaRacha,
                    rachaMax,
                    numeroLimpio
                ]
            );

            let mensajeRango = '';

            if (
                nuevoRango !== rangoAnterior &&
                nuevoPuntaje > usuarioBD.puntos_experiencia
            ) {
                mensajeRango =
                    `\n🎉 *¡Ascenso!* Ahora eres rango *${nuevoRango}*.\n`;
            }

            if (
                nuevoRango !== rangoAnterior &&
                nuevoPuntaje < usuarioBD.puntos_experiencia
            ) {
                mensajeRango =
                    `\n⚠️ *Descenso.* Has bajado a *${nuevoRango}*.\n`;
            }

            const signo =
                puntosCambiados > 0 ? '+' : '';

            await client.sendMessage(
                chatId,
                `${feedbackLimpio}

${mensajeRango}*Progreso:* ${signo}${puntosCambiados} pts | Racha: 🔥 ${nuevaRacha}`
            );

        } else {

            await client.sendMessage(
                chatId,
                feedbackLimpio
            );
        }

        /*
         * Sesiones programadas:
         * una pregunta y termina.
         */
        if (
            sesion.origen === 'PROGRAMADO_DIARIO' ||
            sesion.origen === 'PROGRAMADO_OLVIDO'
        ) {

            delete estadoUsuariosActivos[numeroLimpio];

            await client.sendMessage(
                chatId,
                `✅ *¡Repaso completado!*

Has terminado tu dosis de estudio.

_Escribe *!sesion* si deseas iniciar un estudio profundo._`
            );

            return;
        }
        const promptSiguiente = `
Actúa como un tutor empático.

Basándote ESTRICTAMENTE en este material:

---
${sesion.contenido}
---

Genera UNA NUEVA pregunta de opción múltiple con 4 opciones.

NO repitas la pregunta anterior:
"${sesion.pregunta_actual}"

REGLAS DE FORMATO CRÍTICAS:
1. Devuelve ÚNICAMENTE un objeto JSON válido.
2. NO incluyas markdown, bloques de código ni la palabra "json".
3. Usa comillas dobles válidas para todas las claves y valores.
4. Si necesitas usar comillas dentro del texto, escápalas correctamente.
5. Las opciones deben ser breves.
6. "respuesta_correcta" debe coincidir EXACTAMENTE con una opción del array.
7. No agregues ningún texto antes ni después del objeto.

Estructura exacta:

{
    "pregunta": "El texto de la pregunta",
    "opciones": [
        "Opción A",
        "Opción B",
        "Opción C",
        "Opción D"
    ],
    "respuesta_correcta": "El texto exacto de la opción correcta"
}
`;

        const resSiguiente =
            await model.generateContent(promptSiguiente);

        let textoIA =
            await resSiguiente.response.text();

        textoIA = textoIA
            .replace(/```json/gi, '')
            .replace(/```/gi, '')
            .trim();

        const datosPregunta =
            JSON.parse(textoIA);

        const opcionesUnicas =
            [...new Set(datosPregunta.opciones)];

        let mensajePregunta =
            `*Siguiente pregunta*\n\n` +
            `${datosPregunta.pregunta}\n\n`;

        opcionesUnicas.forEach((opcion, index) => {
            mensajePregunta +=
                `*${index + 1}.* ${opcion}\n`;
        });

        mensajePregunta +=
            `\n_Responde únicamente con el número._\n\n` +
            `_Puedes escribir *!terminar* para finalizar._`;

        estadoUsuariosActivos[numeroLimpio]
            .pregunta_actual =
            datosPregunta.pregunta;

        estadoUsuariosActivos[numeroLimpio]
            .respuesta_correcta =
            datosPregunta.respuesta_correcta;

        estadoUsuariosActivos[numeroLimpio]
            .opciones_actuales =
            opcionesUnicas;

        estadoUsuariosActivos[numeroLimpio]
            .temporizador =
            crearTemporizadorSesion(
                numeroLimpio,
                chatId,
                sesion.id_sesion_db
            );

        estadoUsuariosActivos[numeroLimpio]
            .paso =
            'ESPERANDO_RESPUESTA_SESION';

        await client.sendMessage(
            chatId,
            mensajePregunta
        );
    }
}

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        executablePath: '/usr/bin/chromium-browser',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        timeout: 60000
    }
});

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    console.log('¡Bot funcionando!');
    const myNumberId = client.info.wid._serialized;

    try {
        await client.sendMessage(myNumberId, "¡Hola! El bot ya está en línea.");
    } catch (err) {
        console.error('Error al enviarte el mensaje de inicio:', err);
    }

    //PILDORAS PROGRAMADAS POR EL USUARIO
    cron.schedule('* * * * *', async () => {
        try {
            const ahora = new Date();
            const horas = String(ahora.getHours()).padStart(2, '0');
            const minutos = String(ahora.getMinutes()).padStart(2, '0');
            const horaExactaQuery = `${horas}:${minutos}:00`;

            const queryPildora = `
                SELECT id_usuario, numero_telefono, nombre 
                FROM usuario 
                WHERE hora_pildora = ? 
                  AND activo = 1 
                  AND (fecha_ultima_pildora IS NULL OR fecha_ultima_pildora < CURDATE())
            `;

            const [usuarios] = await pool.execute(queryPildora, [horaExactaQuery]);

            if (usuarios.length > 0) {
                console.log(`Son las ${horas}:${minutos}. Enviando ${usuarios.length} píldoras de conocimiento...`);

                for (const user of usuarios) {
                    const chatId = `${user.numero_telefono}@c.us`;

                    await pool.execute(
                        'UPDATE usuario SET fecha_ultima_pildora = CURDATE() WHERE id_usuario = ?',
                        [user.id_usuario]
                    );

                    const [temas] = await pool.execute(
                        'SELECT DISTINCT tema_o_archivo FROM interaccion_estudio WHERE id_usuario = ?',
                        [user.id_usuario]
                    );

                    let mensajePildora = `*Píldora de Conocimiento*\n\n¡Hola, ${user.nombre}! Es la hora de tu repaso diario.\n\n`;

                    if (temas.length > 0) {
                        mensajePildora += `*¿Qué te gustaría repasar hoy?* (Responde con el número):\n\n`;
                        temas.forEach((t, index) => {
                            mensajePildora += `${index + 1}. ${t.tema_o_archivo}\n`;
                        });
                        mensajePildora += `\n_O escribe "cancelar" para omitir por ahora._`;

                        estadoUsuariosActivos[user.numero_telefono] = {
                            paso: 'ESPERANDO_ELECCION_TEMA',
                            listaTemas: temas.map(t => t.tema_o_archivo),
                            origen: 'PROGRAMADO_DIARIO'
                        };
                    } else {
                        mensajePildora += `Aún no tienes materiales registrados. ¡Envíame un documento para empezar a estudiar!`;
                    }

                    try {
                        await client.sendMessage(chatId, mensajePildora);
                        console.log(`Píldora enviada a ${user.nombre}`);
                    } catch (err) {
                        console.error(`Error al enviar píldora a ${user.numero_telefono}:`, err);
                    }
                }
            }
        } catch (error) {
            console.error('Error en el Reloj Maestro de Píldoras:', error);
        }
    });

    // REPASOS PROGRAMADOS POR EL USUARIO (CADA 6 HORAS)
    cron.schedule('*/5 * * * *', async () => {
        try {
            const query = `
                SELECT i.id_interaccion, i.tema_o_archivo, u.numero_telefono, u.nombre, u.id_usuario
                FROM interaccion_estudio i
                JOIN usuario u ON i.id_usuario = u.id_usuario
                WHERE i.tipo_interaccion = 'REPASO_PROGRAMADO' 
                  AND i.estado = 'PENDIENTE'
                  AND i.fecha_creacion <= DATE_SUB(NOW(), INTERVAL 6 HOUR)
                  AND u.activo = 1
            `;

            const [repasos] = await pool.execute(query);

            if (repasos.length > 0) {
                console.log(`Encontrados ${repasos.length} repasos pendientes. Agrupando por usuario...`);

                const usuariosPendientes = {};
                for (const repaso of repasos) {
                    if (!usuariosPendientes[repaso.numero_telefono]) {
                        usuariosPendientes[repaso.numero_telefono] = {
                            nombre: repaso.nombre,
                            id_usuario: repaso.id_usuario,
                            temas: [],
                            ids_interaccion: []
                        };
                    }

                    if (!usuariosPendientes[repaso.numero_telefono].temas.includes(repaso.tema_o_archivo)) {
                        usuariosPendientes[repaso.numero_telefono].temas.push(repaso.tema_o_archivo);
                    }
                    usuariosPendientes[repaso.numero_telefono].ids_interaccion.push(repaso.id_interaccion);
                }

                for (const numero in usuariosPendientes) {
                    const datosUsuario = usuariosPendientes[numero];
                    const chatId = `${numero}@c.us`;

                    let menuRecordatorio = `*Recordatorio de Estudio*\n\n¡Hola, ${datosUsuario.nombre}! Tienes material que procesé hace un rato y está listo para ser afianzado en tu memoria.\n\n*¿Cuál de estos temas pendientes te gustaría repasar ahora?* (Responde con el número):\n\n`;

                    datosUsuario.temas.forEach((t, index) => {
                        menuRecordatorio += `${index + 1}. ${t}\n`;
                    });
                    menuRecordatorio += `\n_O escribe "cancelar" para omitir por ahora._`;

                    try {
                        await client.sendMessage(chatId, menuRecordatorio);

                        estadoUsuariosActivos[numero] = {
                            paso: 'ESPERANDO_ELECCION_TEMA',
                            listaTemas: datosUsuario.temas,
                            origen: 'PROGRAMADO_OLVIDO'
                        };

                        const ids = datosUsuario.ids_interaccion.join(',');
                        await pool.query(
                            `UPDATE interaccion_estudio SET estado = 'COMPLETADO', fecha_completado = NOW() WHERE id_interaccion IN (${ids})`
                        );

                        console.log(`Recordatorio agrupado enviado a ${datosUsuario.nombre} y marcado en BD.`);

                    } catch (err) {
                        console.error(`Error enviando recordatorio agrupado a ${numero}:`, err);
                    }
                }
            }
        } catch (error) {
            console.error('Error en el cron de repasos programados:', error);
        }
    });

    // EVALUACIÓN SEMANAL DE PROGRESO
    cron.schedule('0 9 * * 1', async () => {
        try {
            console.log('Iniciando disparador de re-evaluación semanal...');
            const query = `
                SELECT u.numero_telefono, u.nombre, u.id_carrera, c.nombre_carrera, d.id_disciplina, d.nombre_disciplina
                FROM usuario u
                JOIN carrera c ON u.id_carrera = c.id_carrera
                JOIN disciplina d ON c.id_disciplina = d.id_disciplina
                WHERE u.diagnostico_completo = 1 AND u.activo = 1
            `;

            const [usuarios] = await pool.execute(query);

            for (const user of usuarios) {
                const chatId = `${user.numero_telefono}@c.us`;

                const mensajeIntro = `*Evaluación Semanal de Progreso*\n\n¡Hola, ${user.nombre}! Ha pasado una semana desde tu última revisión general. Es momento de poner a prueba lo que has aprendido en *${user.nombre_carrera}* para ver si tu nivel ha evolucionado.\n\n¿Estás listo? Empecemos con la primera pregunta...`;

                try {
                    await client.sendMessage(chatId, mensajeIntro);

                    try {
                        const chat = await client.getChatById(chatId);
                        chat.sendStateTyping();
                    } catch (e) { }

                    await hacerPreguntaDiagnostico(
                        user.numero_telefono,
                        chatId,
                        user.id_carrera,
                        user.nombre_carrera,
                        'Principiante',
                        1,
                        0
                    );

                    console.log(`Evaluación semanal enviada a ${user.nombre}`);
                } catch (err) {
                    console.error(`Error al enviar evaluación semanal a ${user.numero_telefono}:`, err);
                }
            }
        } catch (error) {
            console.error('Error en el cron de evaluación semanal:', error);
        }
    });
});

/*
    Manejo de mensajes de usuarios externos (no en mi chat)
*/
client.on('message', async (msg) => {
    if (msg.fromMe || msg.from.includes('@g.us') || msg.from === 'status@broadcast') {
        return;
    }

    const contacto = await msg.getContact();
    const numeroLimpio = await resolverNumeroReal(msg.from, contacto);

    const textoUsuario = msg.body.trim();

    try {
        const [rows] = await pool.execute('SELECT * FROM usuario WHERE numero_telefono = ?', [numeroLimpio]);

        if (rows.length === 0) {
            const estadoActual = usuariosEnRegistro[numeroLimpio]?.paso || 'INICIO';
            if (pasosRegistro[estadoActual]) {
                await pasosRegistro[estadoActual](msg, numeroLimpio, textoUsuario);
            } else {
                await msg.reply('Hubo un error con tu registro. Empecemos de nuevo.');
                delete usuariosEnRegistro[numeroLimpio];
            }
            return;
        }

        const usuarioBD = rows[0];

        if (usuarioBD.activo === 0 && textoUsuario.toLowerCase() !== '!reanudar') {
            return;
        }

        const estadoComando = estadoUsuariosActivos[numeroLimpio]?.paso;

        if (textoUsuario.startsWith('!')) {
            const nombreComando = textoUsuario.split(' ')[0].toLowerCase();

            if (estadoUsuariosActivos[numeroLimpio]?.temporizador) {
                clearTimeout(estadoUsuariosActivos[numeroLimpio].temporizador);
            }

            if (estadoComando && nombreComando !== '!terminar') {
                delete estadoUsuariosActivos[numeroLimpio];
            }

            if (comandos[nombreComando]) {
                await comandos[nombreComando].execute(msg, numeroLimpio, usuarioBD, estadoUsuariosActivos, pool, genAI, hacerPreguntaDiagnostico);
            } else if (nombreComando === '!ayuda') {
                await msg.reply('*Comandos de SmartPathAI:*\n\n- !horapildora - Cambiar hora\n- !carrera - Cambiar carrera\n- !disciplina - Cambiar área\n- !sesion - Iniciar estudio\n- !terminar - Finalizar sesión de estudio\n- !progreso - Ver tus estadísticas\n- !evaluacion - Solicitar realizar evaluación de diagnóstico\n- !desactivar - Pausar notificaciones y respuestas del bot\n- !reanudar - Reactivar el bot');
            } else {
                await msg.reply('Ese comando no existe. Escribe *!ayuda* para ver las opciones.');
            }
            return;
        }

        if (estadoComando) {
            if (textoUsuario.toLowerCase() === 'cancelar') {
                if (estadoUsuariosActivos[numeroLimpio]?.temporizador) {
                    clearTimeout(estadoUsuariosActivos[numeroLimpio].temporizador);
                }

                delete estadoUsuariosActivos[numeroLimpio];
                await msg.reply('Operación cancelada.');
                return;
            }

            if (estadoComando === 'ESPERANDO_NUEVA_HORA') {
                const regexHora = /^([01]\d|2[0-3]):([0-5]\d)$/;
                if (!regexHora.test(textoUsuario)) {
                    await msg.reply('Formato incorrecto. Usa HH:MM (ejemplo: 08:00 o 15:30) o escribe *cancelar*.');
                    return;
                }
                await pool.execute(
                    'UPDATE usuario SET hora_pildora = ? WHERE numero_telefono = ?',
                    [textoUsuario, numeroLimpio]
                );

                delete estadoUsuariosActivos[numeroLimpio];
                await msg.reply(`¡Listo, ${usuarioBD.nombre}! He actualizado tu Píldora de Conocimiento para las *${textoUsuario}*.`);
                return;
            }

            if (estadoComando === 'ESPERANDO_NUEVA_DISCIPLINA') {
                const idDisciplina = parseInt(textoUsuario);

                if (isNaN(idDisciplina)) {
                    await msg.reply('Por favor, ingresa un número válido o escribe *cancelar*.');
                    return;
                }
                const [carreras] = await pool.execute(
                    'SELECT id_carrera, nombre_carrera FROM carrera WHERE id_disciplina = ?',
                    [idDisciplina]
                );

                if (carreras.length === 0) {
                    await msg.reply('Esa área no existe o aún no tiene carreras registradas. Intenta con otro número o escribe *cancelar*.');
                    return;
                }
                estadoUsuariosActivos[numeroLimpio].paso = 'ESPERANDO_NUEVA_CARRERA';

                let menuCarreras = `Excelente. Ahora selecciona tu nueva carrera dentro de esta área *(Responde solo con el número o escribe "cancelar")*:\n\n`;
                carreras.forEach(c => {
                    menuCarreras += `${c.id_carrera}. ${c.nombre_carrera}\n`;
                });

                await msg.reply(menuCarreras);
                return;
            }

            if (estadoComando === 'ESPERANDO_NUEVA_CARRERA') {
                const idCarrera = parseInt(textoUsuario);
                if (isNaN(idCarrera)) {
                    await msg.reply('Por favor, ingresa un número válido o escribe *cancelar*.');
                    return;
                }
                const [carreraValida] = await pool.execute('SELECT nombre_carrera FROM carrera WHERE id_carrera = ?', [idCarrera]);

                if (carreraValida.length === 0) {
                    await msg.reply('Ese número de carrera no existe. Intenta de nuevo o escribe *cancelar*.');
                    return;
                }
                await pool.execute('UPDATE usuario SET id_carrera = ? WHERE numero_telefono = ?', [idCarrera, numeroLimpio]);
                delete estadoUsuariosActivos[numeroLimpio];

                await msg.reply(`¡Listo, ${usuarioBD.nombre}! Tu perfil ha sido actualizado a la carrera de *${carreraValida[0].nombre_carrera}*.`);
                return;
            }

            if (estadoComando === 'ESPERANDO_ELECCION_TEMA') {
                const indice = parseInt(textoUsuario) - 1;
                const temasDisponibles = estadoUsuariosActivos[numeroLimpio].listaTemas;
                const origenSesion = estadoUsuariosActivos[numeroLimpio].origen || 'MANUAL';

                if (isNaN(indice) || !temasDisponibles[indice]) {
                    await msg.reply('Selección inválida.');
                    return;
                }

                const temaElegido = temasDisponibles[indice];

                await pool.execute(
                    `UPDATE interaccion_estudio SET estado = 'COMPLETADO', fecha_completado = NOW() 
                    WHERE id_usuario = ? AND tipo_interaccion = 'SESION_ACTIVA' AND estado = 'EN_CURSO'`,
                    [usuarioBD.id_usuario]
                );

                const [resultado] = await pool.execute(
                    `INSERT INTO interaccion_estudio 
                        (id_usuario, tema_o_archivo, tipo_interaccion, estado, fecha_creacion) 
                        VALUES (?, ?, 'SESION_ACTIVA', 'EN_CURSO', NOW())`,
                    [usuarioBD.id_usuario, temaElegido]
                );

                const idSesionDB = resultado.insertId;

                const [archivos] = await pool.execute(
                    'SELECT contenido FROM interaccion_estudio WHERE id_usuario = ? AND tema_o_archivo = ? AND contenido IS NOT NULL LIMIT 1',
                    [usuarioBD.id_usuario, temaElegido]
                );

                const contenido = archivos[0]?.contenido || "Contenido no disponible.";

                const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
                const prompt = `Actúa como un tutor universitario empático. El estudiante está repasando el tema "${temaElegido}". 
                    Aquí tienes el material de estudio. Debes basarte ESTRICTAMENTE en esta información:
                    ---
                    ${contenido} 
                    ---
                    Genera UNA sola pregunta de opción múltiple con 4 opciones basándote ÚNICAMENTE en el texto. 

                    REGLAS DE FORMATO CRÍTICAS:
                    1. Devuelve ÚNICAMENTE un objeto JSON válido.
                    2. NO incluyas markdown, ni comillas invertidas, ni la palabra "json".
                    3. Las opciones deben ser breves (máximo 60 caracteres cada una).
                    4. Sigue esta estructura exacta:
                    {
                        "pregunta": "El texto de la pregunta",
                        "opciones": ["Opción A", "Opción B", "Opción C", "Opción D"],
                        "respuesta_correcta": "El texto exacto de la opción correcta (debe coincidir con una del array)"
                    }`;

                try {
                    const result = await model.generateContent(prompt);
                    let textoIA = await result.response.text();
                    textoIA = textoIA.replace(/```json/gi, '').replace(/```/gi, '').trim();
                    const datosPregunta = JSON.parse(textoIA);

                    const opcionesUnicas = [...new Set(datosPregunta.opciones)];
                    if (opcionesUnicas.length < 2) {
                        opcionesUnicas.push("Opción no disponible", "Contactar soporte");
                    }

                    const chatReal =
                        `${numeroLimpio}@c.us`;

                    let mensajePregunta =
                        `*¡Sesión iniciada!*\n\n` +
                        `${datosPregunta.pregunta}\n\n`;

                    opcionesUnicas.forEach((opcion, index) => {
                        mensajePregunta +=
                            `*${index + 1}.* ${opcion}\n`;
                    });

                    mensajePregunta +=
                        `\n_Responde únicamente con el número de la opción._`;

                    estadoUsuariosActivos[numeroLimpio] = {
                        paso: 'ESPERANDO_RESPUESTA_SESION',
                        tema: temaElegido,
                        contenido: contenido,
                        id_sesion_db: idSesionDB,
                        pregunta_actual: datosPregunta.pregunta,
                        opciones_actuales: opcionesUnicas,
                        respuesta_correcta: datosPregunta.respuesta_correcta,
                        temporizador: crearTemporizadorSesion(numeroLimpio, chatReal, idSesionDB),
                        origen: origenSesion
                    };

                    await client.sendMessage(chatReal, mensajePregunta);

                    return;

                } catch (err) {
                    console.error('Error al generar JSON de la pregunta:', err);
                    await msg.reply('Tuve un problema al formular la pregunta. Intenta seleccionar el tema nuevamente.');
                    delete estadoUsuariosActivos[numeroLimpio];
                    return;
                }
            }

            if (estadoComando === 'ESPERANDO_RESPUESTA_SESION' || estadoComando === 'EVALUANDO_DIAGNOSTICO') {
                const sesion = estadoUsuariosActivos[numeroLimpio];

                const numeroRespuesta =
                    parseInt(textoUsuario);

                if (
                    isNaN(numeroRespuesta) ||
                    numeroRespuesta < 1 ||
                    numeroRespuesta > sesion.opciones_actuales.length
                ) {
                    await msg.reply(
                        `Por favor responde únicamente con un número del 1 al ${sesion.opciones_actuales.length}.`
                    );

                    return;
                }

                const opcionElegida =
                    sesion.opciones_actuales[
                    numeroRespuesta - 1
                    ];

                const chatId =
                    `${numeroLimpio}@c.us`;

                await procesarRespuestaOpcion(
                    numeroLimpio,
                    chatId,
                    opcionElegida
                );

                return;
            }
        }

    } catch (dbError) {
        console.error('Error de base de datos:', dbError);
        await msg.reply('Lo siento, estoy teniendo problemas técnicos con mi base de datos. Intenta en unos minutos.');
        return;
    }

    if (msg.hasMedia) {
        try {
            if (msg.hasMedia) {
                console.log('Recibiendo archivo de un usuario externo...');
                try {

                    if (
                        msg.id &&
                        !msg.id._serialized &&
                        msg.id.$1
                    ) {
                        msg.id._serialized = msg.id.$1;
                    }

                    const media = await msg.downloadMedia();

                    if (media) {
                        let rutaGuardado;
                        if (media.filename) {
                            rutaGuardado = `./descargas/${media.filename}`;
                        } else {
                            rutaGuardado = `./descargas/archivo_${numeroLimpio}_${Date.now()}.${extension}`;
                        }
                        const extension = rutaGuardado.split('.').pop().toLowerCase();
                        fs.writeFileSync(rutaGuardado, media.data, 'base64');
                        console.log(`Archivo guardado exitosamente en: ${rutaGuardado}`);
                        try {
                            const chat = await msg.getChat();
                            chat.sendStateTyping();
                        } catch (e) { }

                        if (extension === 'pdf') {
                            await msg.reply('Recibí tu PDF. Lo estoy analizando, dame un segundo...');
                            try {
                                let dataBuffer = await fs.promises.readFile(rutaGuardado);
                                let data = await pdf(dataBuffer);

                                let resumenIA = await analizarDocumentoIA(data.text);
                                await msg.reply(`*¡Lectura completada!*\n\nAquí tienes un resumen de lo que encontré en tu documento:\n\n${resumenIA}`);

                                await registrarInteraccion(pool, numeroLimpio, media.filename || 'Documento PDF', data.text);
                            } catch (errorLectura) {
                                console.error('Error al extraer texto del PDF:', errorLectura);
                                await msg.reply('Pude guardar tu PDF, pero hubo un error al intentar leer su contenido de texto.');
                            }
                        }
                        else if (extension === 'txt') {
                            await msg.reply('Leyendo documento de texto...');
                            try {
                                let textoExtraido = await fs.promises.readFile(rutaGuardado, 'utf8');

                                let resumenIA = await analizarDocumentoIA(textoExtraido);
                                await msg.reply(`*¡Lectura completada!*\n\nAquí tienes un resumen de lo que encontré:\n\n${resumenIA}`);

                                await registrarInteraccion(pool, numeroLimpio, media.filename || 'Documento TXT', textoExtraido);
                            } catch (errorLectura) {
                                console.error('Error al leer el archivo TXT:', errorLectura);
                                await msg.reply('Pude guardar tu archivo TXT, pero hubo un error al intentar leerlo.');
                            }
                        }
                        else if (extension === 'docx') {
                            await msg.reply('Recibí tu documento de Word. Lo estoy analizando...');
                            try {
                                const result = await mammoth.extractRawText({ path: rutaGuardado });

                                let resumenIA = await analizarDocumentoIA(result.value);
                                await msg.reply(`*¡Lectura completada!*\n\nEsto es lo principal que detecté en tu archivo Word:\n\n${resumenIA}`);

                                await registrarInteraccion(pool, numeroLimpio, media.filename || 'Documento DOCX', result.value);
                            } catch (errorLectura) {
                                console.error('Error al extraer texto de Word:', errorLectura);
                                await msg.reply('Pude guardar tu archivo Word, pero hubo un error al intentar extraer su contenido.');
                            }
                        }
                        else if (extension === 'png' || extension === 'jpg' || extension === 'jpeg') {
                            await msg.reply('Recibí tu imagen. La he guardado en tu expediente para analizarla.');
                        }
                        else {
                            await msg.reply(`Recibí tu archivo. Lo guardé con éxito en tu expediente.`);
                        }
                    }
                } catch (error) {
                    console.error('Error al descargar el archivo:', error);
                    await msg.reply('Hubo un problema al intentar descargar tu archivo.');
                }
                return;
            }
        } catch (error) {
            console.error('Error al descargar el archivo:', error);
            await msg.reply('Hubo un problema al intentar descargar tu archivo.');
        }
        return;
    }
});

/*
    Manejo de respuestas en ENCUESTAS 
*/

// client.on('vote_update', async (vote) => {
//     try {
//         if (!vote.selectedOptions || vote.selectedOptions.length === 0) return;
//         const voterId = vote.voter || vote.sender || vote.author;

//         if (!voterId) {
//             return;
//         }

//         let contactoVotante = null;
//         try {
//             contactoVotante = await client.getContactById(voterId);
//         } catch (e) { }

//         const numeroLimpio = await resolverNumeroReal(voterId, contactoVotante);

//         console.log(`[DEBUG VOTO] voterId: ${voterId} | Número Real: ${numeroLimpio}`);
//         console.log(`[DEBUG VOTO] Estado en RAM para ${numeroLimpio}:`, estadoUsuariosActivos[numeroLimpio] ? estadoUsuariosActivos[numeroLimpio].paso : 'NO EXISTE EN RAM');

//         const sesion = estadoUsuariosActivos[numeroLimpio];
//         if (!sesion || (sesion.paso !== 'ESPERANDO_VOTO_SESION' && sesion.paso !== 'EVALUANDO_DIAGNOSTICO')) return;

//         const flujoActual = sesion.paso;
//         estadoUsuariosActivos[numeroLimpio].paso = 'PROCESANDO_VOTO';

//         const chatId = `${numeroLimpio}@c.us`;
//         if (sesion.temporizador) clearTimeout(sesion.temporizador);

//         const opcionElegida = vote.selectedOptions[0].name;
//         const esCorrecto = opcionElegida === sesion.respuesta_correcta;
//         const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

//         if (flujoActual === 'ESPERANDO_VOTO_SESION') {
//             const [rows] = await pool.execute('SELECT * FROM usuario WHERE numero_telefono = ?', [numeroLimpio]);
//             if (rows.length === 0) return;
//             const usuarioBD = rows[0];

//             const promptEval = `Actúa como un tutor empático.
//             La pregunta era: "${sesion.pregunta_actual}"
//             El estudiante seleccionó: "${opcionElegida}"
//             La respuesta correcta era: "${sesion.respuesta_correcta}"
//             Explícale brevemente y de forma constructiva por qué su elección es ${esCorrecto ? 'correcta' : 'incorrecta'}. No uses emojis.`;

//             const resEval = await model.generateContent(promptEval);
//             const feedbackLimpio = await resEval.response.text();

//             if (sesion.origen === 'PROGRAMADO_DIARIO') {
//                 const { nuevoPuntaje, nuevaRacha, puntosCambiados } = calcularProgresion(usuarioBD.puntos_experiencia, usuarioBD.racha_actual, esCorrecto);
//                 const nuevoRango = obtenerRango(nuevoPuntaje);
//                 const rangoAnterior = obtenerRango(usuarioBD.puntos_experiencia);
//                 let rachaMax = usuarioBD.racha_maxima;
//                 if (nuevaRacha > rachaMax) rachaMax = nuevaRacha;

//                 await pool.execute(
//                     'UPDATE usuario SET puntos_experiencia = ?, racha_actual = ?, racha_maxima = ?, fecha_ultima_pildora_correcta = NOW() WHERE numero_telefono = ?',
//                     [nuevoPuntaje, nuevaRacha, rachaMax, numeroLimpio]
//                 );

//                 let mensajeRango = '';
//                 if (nuevoRango !== rangoAnterior && nuevoPuntaje > usuarioBD.puntos_experiencia) {
//                     mensajeRango = `\n🎉 *¡Ascenso!* Ahora eres rango *${nuevoRango}*.\n`;
//                 } else if (nuevoRango !== rangoAnterior && nuevoPuntaje < usuarioBD.puntos_experiencia) {
//                     mensajeRango = `\n⚠️ *Descenso.* Has bajado a *${nuevoRango}*. ¡Recupera tu nivel!\n`;
//                 }
//                 const signo = puntosCambiados > 0 ? '+' : '';

//                 await client.sendMessage(chatId, `${feedbackLimpio}\n\n${mensajeRango}*Progreso:* ${signo}${puntosCambiados} pts | Racha: 🔥 ${nuevaRacha}`);
//             } else {
//                 await client.sendMessage(chatId, feedbackLimpio);
//             }

//             if (sesion.origen === 'PROGRAMADO_DIARIO' || sesion.origen === 'PROGRAMADO_OLVIDO') {
//                 delete estadoUsuariosActivos[numeroLimpio];
//                 await client.sendMessage(chatId, '✅ *¡Repaso completado!* Has terminado tu dosis de estudio.\n\n_Escribe *!sesion* si deseas iniciar un estudio profundo._');
//                 return;
//             }

//             const promptSiguiente = `Actúa como un tutor empático. Basándote ESTRICTAMENTE en este material:
//                 ---
//                 ${sesion.contenido}
//                 ---
//                 Genera UNA NUEVA pregunta de opción múltiple con 4 opciones. 
//                 NO repitas la pregunta anterior: "${sesion.pregunta_actual}".

//                 REGLAS DE FORMATO CRÍTICAS:
//                 1. Devuelve ÚNICAMENTE un objeto JSON válido.
//                 2. NO incluyas markdown, ni comillas invertidas, ni la palabra "json".
//                 3. Las opciones deben ser breves (máximo 60 caracteres cada una).
//                 4. Sigue esta estructura exacta:
//                 {
//                     "pregunta": "El texto de la pregunta",
//                     "opciones": ["Opción A", "Opción B", "Opción C", "Opción D"],
//                     "respuesta_correcta": "El texto exacto de la opción correcta"
//                 }`;

//             const resSiguiente = await model.generateContent(promptSiguiente);
//             let textoIA = await resSiguiente.response.text();
//             textoIA = textoIA.replace(/```json/gi, '').replace(/```/gi, '').trim();
//             const datosPregunta = JSON.parse(textoIA);

//             const opcionesUnicas = [...new Set(datosPregunta.opciones)];
//             if (opcionesUnicas.length < 2) {
//                 opcionesUnicas.push("Opción no disponible", "Contactar soporte");
//             }

//             const { Poll } = require('whatsapp-web.js');
//             const nuevaEncuesta = new Poll(datosPregunta.pregunta, opcionesUnicas);

//             await client.sendMessage(chatId, 'Siguiente pregunta: 👇 (Puedes terminar la sesión en cualquier momento escribiendo *!terminar*)');
//             await client.sendMessage(chatId, nuevaEncuesta);

//             estadoUsuariosActivos[numeroLimpio].pregunta_actual = datosPregunta.pregunta;
//             estadoUsuariosActivos[numeroLimpio].respuesta_correcta = datosPregunta.respuesta_correcta;
//             estadoUsuariosActivos[numeroLimpio].temporizador = crearTemporizadorSesion(numeroLimpio, chatId, sesion.id_sesion_db);
//             estadoUsuariosActivos[numeroLimpio].paso = 'ESPERANDO_VOTO_SESION';
//         }
//         else if (flujoActual === 'EVALUANDO_DIAGNOSTICO') {
//             const promptEval = `Actúa como un tutor evaluando a un alumno. 
//             Pregunta: "${sesion.pregunta_actual}"
//             El alumno seleccionó: "${opcionElegida}"
//             La respuesta correcta era: "${sesion.respuesta_correcta}"

//             Explica brevemente por qué es ${esCorrecto ? 'correcta' : 'incorrecta'} de manera motivadora (sin emojis).`;

//             const resEval = await model.generateContent(promptEval);
//             const feedback = await resEval.response.text();

//             if (esCorrecto) {
//                 sesion.puntaje += 1;
//             }

//             await client.sendMessage(chatId, feedback.trim());

//             if (sesion.numero_pregunta === 1) {
//                 await hacerPreguntaDiagnostico(numeroLimpio, chatId, sesion.id_carrera, sesion.nombre_carrera, 'Intermedio', 2, sesion.puntaje);
//             } else if (sesion.numero_pregunta === 2) {
//                 await hacerPreguntaDiagnostico(numeroLimpio, chatId, sesion.id_carrera, sesion.nombre_carrera, 'Avanzado', 3, sesion.puntaje);
//             } else {
//                 let nivelFinal = 'Principiante';
//                 if (sesion.puntaje === 2) nivelFinal = 'Intermedio';
//                 if (sesion.puntaje === 3) nivelFinal = 'Avanzado';

//                 await pool.execute(
//                     'UPDATE usuario SET nivel_conocimiento = ?, diagnostico_completo = 1 WHERE numero_telefono = ?',
//                     [nivelFinal, numeroLimpio]
//                 );

//                 await client.sendMessage(chatId, `*¡Diagnóstico Completado!*\n\nLograste ${sesion.puntaje} de 3 aciertos.\n\nHe configurado tu nivel en la carrera de ${sesion.nombre_carrera} como: *${nivelFinal}*.\n\n¡Ya puedes enviarme tus documentos para comenzar a estudiar o escribir *!ayuda* para ver mis comandos!`);
//                 delete estadoUsuariosActivos[numeroLimpio];
//             }
//         }

//     } catch (error) {
//         console.error('Error al procesar el voto:', error);
//         await client.sendMessage(chatId, 'Lo siento, tuve un problema técnico al procesar tu respuesta. Intenta de nuevo.');
//         estadoUsuariosActivos[numeroLimpio].paso = flujoActual;
//     }
// });

client.initialize();