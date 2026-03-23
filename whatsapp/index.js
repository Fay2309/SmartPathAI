const { Client, LocalAuth } = require('whatsapp-web.js'); // Librería para interactuar con WhatsApp Web [PRINCIPAL]
const qrcode = require('qrcode-terminal'); // Para generar el código QR en la terminal
const fs = require('fs');
const pdf = require('pdf-parse'); // Para extraer texto de PDFs
const mammoth = require('mammoth'); // Para extraer texto de archivos DOCX
const cron = require('node-cron');
const mysql = require('mysql2/promise');

const comandos = {
    '!horapildora': require('./comandos/!horapildora'),
};

const usuariosEnRegistro = {};
const estadoUsuariosActivos = {};

const pasosRegistro = {
    'INICIO': async (msg, numeroLimpio) => {
        usuariosEnRegistro[numeroLimpio] = { paso: 'ESPERANDO_NOMBRE' };
        await msg.reply('Bot: ¡Hola! Veo que eres nuevo por aquí. Soy *SmartPathAI*, tu tutor inteligente.\n\nPara poder personalizar tu experiencia, necesito unos datos rápidos.\n\n¿Cómo te gustaría que te llame?');
    },

    'ESPERANDO_NOMBRE': async (msg, numeroLimpio, textoUsuario) => {
        usuariosEnRegistro[numeroLimpio].nombre = textoUsuario;
        usuariosEnRegistro[numeroLimpio].paso = 'ESPERANDO_DISCIPLINA';
        
        const [disciplinas] = await pool.execute('SELECT id_disciplina, nombre_disciplina FROM disciplina');
        let menuDisciplinas = `Bot: ¡Mucho gusto, ${textoUsuario}! \n\nPara adaptar tu tutoría, ¿a qué área de estudio perteneces? *(Responde solo con el número)*:\n\n`;
        disciplinas.forEach(d => { menuDisciplinas += `${d.id_disciplina}. ${d.nombre_disciplina}\n`; });
        await msg.reply(menuDisciplinas);
    },

    'ESPERANDO_DISCIPLINA': async (msg, numeroLimpio, textoUsuario) => {
        const idDisciplina = parseInt(textoUsuario);
        const [disciplinaValida] = await pool.execute('SELECT id_disciplina FROM disciplina WHERE id_disciplina = ?', [idDisciplina]);
        
        if (isNaN(idDisciplina) || disciplinaValida.length === 0) {
            await msg.reply('Bot: Por favor, ingresa un número válido de la lista anterior.');
            return;
        }

        const [carreras] = await pool.execute('SELECT id_carrera, nombre_carrera FROM carrera WHERE id_disciplina = ?', [idDisciplina]);
        if (carreras.length === 0) {
            await msg.reply('Bot: Ups, parece que aún no hay carreras registradas en esta área. Por favor intenta con otra.');
            return;
        }

        usuariosEnRegistro[numeroLimpio].paso = 'ESPERANDO_CARRERA';
        let menuCarreras = `Bot: Excelente elección. Ahora, selecciona tu carrera *(Responde solo con el número)*:\n\n`;
        carreras.forEach(c => { menuCarreras += `${c.id_carrera}. ${c.nombre_carrera}\n`; });
        await msg.reply(menuCarreras);
    },

    'ESPERANDO_CARRERA': async (msg, numeroLimpio, textoUsuario) => {
        const idCarrera = parseInt(textoUsuario);
        const [carreraValida] = await pool.execute('SELECT id_carrera FROM carrera WHERE id_carrera = ?', [idCarrera]);

        if (isNaN(idCarrera) || carreraValida.length === 0) {
            await msg.reply('Bot: Por favor, ingresa un número válido de la lista de carreras.');
            return;
        }

        usuariosEnRegistro[numeroLimpio].id_carrera = idCarrera;
        usuariosEnRegistro[numeroLimpio].paso = 'ESPERANDO_HORA';
        await msg.reply(`Bot: ¡Perfecto! Ya casi terminamos.\n\nTodos los días te enviaré una "Píldora de Conocimiento" para ayudarte a estudiar.\n\n¿A qué hora prefieres recibirla? (Por favor, responde en formato de 24 horas, por ejemplo: *07:00* o *16:30*).`);
    },

    'ESPERANDO_HORA': async (msg, numeroLimpio, textoUsuario) => {
        const regexHora = /^([01]\d|2[0-3]):([0-5]\d)$/; 
        if (!regexHora.test(textoUsuario)) {
            await msg.reply('Bot: Ese formato de hora no parece correcto. Por favor, intenta de nuevo usando el formato HH:MM (ejemplo: 08:00).');
            return;
        }
        
        const { nombre, id_carrera } = usuariosEnRegistro[numeroLimpio];
        await pool.execute(
            'INSERT INTO usuario (id_carrera, nombre, numero_telefono, hora_pildora, fecha_registro) VALUES (?, ?, ?, ?, NOW())', 
            [id_carrera, nombre, numeroLimpio, textoUsuario]
        );
        
        delete usuariosEnRegistro[numeroLimpio]; 
        await msg.reply(`Bot: ¡Excelente! Tu registro está completo.\n\nConfiguré tus píldoras para las *${textoUsuario}*.\n\nYa puedes empezar a enviarme tus archivos (PDF, Word, Fotos) para que comencemos a estudiar.\n\nEscribe *!ayuda* para ver los comandos disponibles de *SmartPathAI*.`);
    }
};

async function registrarInteraccion(numeroTelefono, nombreArchivo) {
    try {
        const [usuarios] = await pool.execute('SELECT id_usuario FROM usuario WHERE numero_telefono = ?', [numeroTelefono]);
        
        if (usuarios.length > 0) {
            const idUsuario = usuarios[0].id_usuario;
            
            await pool.execute(
                `INSERT INTO interaccion_estudio 
                (id_usuario, tema_o_archivo, tipo_interaccion, estado, fecha_creacion) 
                VALUES (?, ?, 'REPASO_PROGRAMADO', 'PENDIENTE', NOW())`,
                [idUsuario, nombreArchivo]
            );
            console.log(`Repaso programado en BD para el archivo: ${nombreArchivo}`);
        }
    } catch (err) {
        console.error('Error al registrar la interacción en BD:', err);
    }
}

const dbConfig = {
    host: 'localhost',
    user: 'root',      
    password: 'hola12',      
    database: 'smartai'
};

const pool = mysql.createPool(dbConfig);

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox']
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
    
    cron.schedule('* * * * *', async () => {
        try {
            const ahora = new Date();
            const horas = String(ahora.getHours()).padStart(2, '0');
            const minutos = String(ahora.getMinutes()).padStart(2, '0');
            const horaExactaQuery = `${horas}:${minutos}:00`; 

            const [usuarios] = await pool.execute(
                `SELECT numero_telefono, nombre FROM usuario WHERE hora_pildora = ?`,
                [horaExactaQuery]
            );

            if (usuarios.length > 0) {
                console.log(`Son las ${horas}:${minutos}. Enviando ${usuarios.length} píldoras de conocimiento...`);
                for (const user of usuarios) {
                    const chatId = `${user.numero_telefono}@c.us`;
                    const mensajePildora = `*Píldora de Conocimiento*\n\n¡Hola, ${user.nombre}! Es la hora de tu repaso programado.\n\n.`;
                    
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

    cron.schedule('*/5 * * * *', async () => {
        try {
            const query = `
                SELECT i.id_interaccion, i.tema_o_archivo, u.numero_telefono, u.nombre
                FROM interaccion_estudio i
                JOIN usuario u ON i.id_usuario = u.id_usuario
                WHERE i.tipo_interaccion = 'REPASO_PROGRAMADO' 
                  AND i.estado = 'PENDIENTE'
                  AND i.fecha_creacion <= DATE_SUB(NOW(), INTERVAL 6 HOUR)
            `;
            
            const [repasos] = await pool.execute(query);

            if (repasos.length > 0) {
                console.log(`Encontrados ${repasos.length} repasos pendientes por la curva del olvido.`);

                for (const repaso of repasos) {
                    const chatId = `${repaso.numero_telefono}@c.us`;
                    
                    const mensajeRecordatorio = `*Recordatorio de Estudio*\n\n¡Hola, ${repaso.nombre}! Han pasado aproximadamente 6 horas desde que procesé tu archivo: *"${repaso.tema_o_archivo}"*.\n\nPara que esta información se fije en tu memoria, es momento de hacer un repaso rápido.\n\n.`;
                    
                    try {
                        await client.sendMessage(chatId, mensajeRecordatorio);
                        await pool.execute(
                            `UPDATE interaccion_estudio 
                             SET estado = 'COMPLETADO', fecha_completado = NOW() 
                             WHERE id_interaccion = ?`, 
                            [repaso.id_interaccion]
                        );
                        console.log(`Recordatorio enviado a ${repaso.nombre} y marcado como completado.`);
                        
                    } catch (err) {
                        console.error(`Error enviando recordatorio a ${repaso.numero_telefono}:`, err);
                    }
                }
            }
        } catch (error) {
            console.error('Error en el cron de repasos programados:', error);
        }
    });
});

/*
    Manejo de mensajes (mi chat)
*/
client.on('message_create', async (msg) => {
    const miNumero = client.info.wid._serialized;
    if (msg.to === miNumero && msg.from === miNumero) {
        if (msg.body.startsWith('Bot:')) return; 
        
        console.log('Mensaje recibido en mi chat de pruebas:', msg.body);
        
        const numeroLimpio = msg.from.split('@')[0];
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
            const estadoComando = estadoUsuariosActivos[numeroLimpio]?.paso;

            if (textoUsuario.startsWith('!')) {
                if (estadoComando) {
                    delete estadoUsuariosActivos[numeroLimpio];
                }
                const nombreComando = textoUsuario.split(' ')[0].toLowerCase();

                if (comandos[nombreComando]) {
                    await comandos[nombreComando].execute(msg, numeroLimpio, usuarioBD, estadoUsuariosActivos);
                } else if (nombreComando === '!ayuda') {
                    await msg.reply('Bot: *Comandos de SmartPathAI:*\n\n!horapildora - Cambiar hora de estudio\n!carrera - Cambiar carrera\n!disciplina - Cambiar área\n!sesion - Iniciar estudio\n!progreso - Ver tus estadísticas');
                } else {
                    await msg.reply('Bot: Ese comando no existe. Escribe *!ayuda* para ver las opciones.');
                }
                return; 
            }
            
            if (estadoComando) {
                if (textoUsuario.toLowerCase() === 'cancelar') {
                    delete estadoUsuariosActivos[numeroLimpio];
                    await msg.reply('Bot: Operación cancelada.');
                    return;
                }

                if (estadoComando === 'ESPERANDO_NUEVA_HORA') {
                    const regexHora = /^([01]\d|2[0-3]):([0-5]\d)$/; 
                    if (!regexHora.test(textoUsuario)) {
                        await msg.reply('Bot: Formato incorrecto. Usa HH:MM (ejemplo: 08:00 o 15:30) o escribe *cancelar*.');
                        return;
                    }
                    await pool.execute(
                        'UPDATE usuario SET hora_pildora = ? WHERE numero_telefono = ?',
                        [textoUsuario, numeroLimpio]
                    );
                    
                    delete estadoUsuariosActivos[numeroLimpio]; 
                    await msg.reply(`Bot: ¡Listo, ${usuarioBD.nombre}! He actualizado tu Píldora de Conocimiento para las *${textoUsuario}*.`);
                    return; 
                }
            }

        } catch (dbError) {
            console.error('Error de base de datos:', dbError);
            await msg.reply('Bot: Lo siento, estoy teniendo problemas técnicos con mi base de datos. Intenta en unos minutos.');
            return;
        }

        if (msg.hasMedia) {
            console.log('Recibiendo archivo en mi chat...');
            try {
                const media = await msg.downloadMedia();

                if (media) {
                    let rutaGuardado;
                    if (media.filename) {
                        rutaGuardado = `./descargas/${media.filename}`;
                    } else {
                        const extension = media.mimetype.split('/')[1].split(';')[0]; 
                        rutaGuardado = `./descargas/archivo_${numeroLimpio}_${Date.now()}.${extension}`;
                    }
                    const extension = rutaGuardado.split('.').pop().toLowerCase();
                    fs.writeFileSync(rutaGuardado, media.data, 'base64');
                    console.log(`Archivo guardado exitosamente en: ${rutaGuardado}`);

                    if (extension === 'pdf') {
                        await msg.reply('Bot: Recibí tu PDF. Lo estoy leyendo, dame un segundo...');
                        try {
                            let dataBuffer = fs.readFileSync(rutaGuardado);
                            let data = await pdf(dataBuffer);
                            let textoExtraido = data.text;
                            await msg.reply(`Bot: ¡Lectura completada!\n\nDetalles del documento:\n- Páginas: ${data.numpages}\n- Caracteres: ${textoExtraido.length}\n\nPrimeras palabras que leí:\n"${textoExtraido.substring(0, 150)}..."`);
                            const numeroLimpio = msg.from.split('@')[0];
                            await registrarInteraccion(numeroLimpio, media.filename || 'Documento PDF');
                        } catch (errorLectura) {
                            console.error('Error al extraer texto del PDF:', errorLectura);
                            await msg.reply('Bot: Pude guardar tu PDF, pero hubo un error al intentar leer su contenido.');
                        }
                    }
                    else if (extension === 'txt') {
                        await msg.reply('Bot: Leyendo documento de texto...');
                        try {
                            let textoExtraido = fs.readFileSync(rutaGuardado, 'utf8');
                            await msg.reply(`Bot: ¡Lectura completada!\n\n Detalles del documento:\n- Caracteres: ${textoExtraido.length}\n\nPrimeras palabras que leí:\n"${textoExtraido.substring(0, 150)}..."`);
                            const numeroLimpio = msg.from.split('@')[0];
                            await registrarInteraccion(numeroLimpio, media.filename || 'Documento TXT');
                        } catch (errorLectura) {
                            console.error('Error al leer el archivo TXT:', errorLectura);
                            await msg.reply('Bot: Pude guardar tu archivo TXT, pero hubo un error al intentar leerlo.');
                        }
                    }  
                    else if (extension === 'docx') {
                        await msg.reply('Bot: Recibí tu documento de Word. Lo estoy extrayendo...');
                        try {
                            const result = await mammoth.extractRawText({ path: rutaGuardado });
                            const textoExtraido = result.value; 
                            await msg.reply(`Bot: ¡Lectura completada!\n\n Detalles del documento:\n- Caracteres: ${textoExtraido.length}\n\n Primeras palabras que leí:\n"${textoExtraido.substring(0, 150)}..."`);
                            const numeroLimpio = msg.from.split('@')[0];
                            await registrarInteraccion(numeroLimpio, media.filename || 'Documento DOCX');
                        } catch (errorLectura) {
                            console.error('Error al extraer texto de Word:', errorLectura);
                            await msg.reply('Bot: Pude guardar tu archivo Word, pero hubo un error al intentar leer su contenido.');
                        }
                    }  
                    else if (extension === 'png' || extension === 'jpg' || extension === 'jpeg') {
                        await msg.reply('Bot: Recibí tu imagen. La he guardado en tu expediente para analizarla.');
                    }    
                    else {
                        await msg.reply(`Bot: Recibí tu archivo. Lo guardé con éxito.`);
                    }
                }
            } catch (error) {
                console.error('Error al descargar el archivo:', error);
                await msg.reply('Bot: Hubo un problema al intentar descargar tu archivo.');
            }
            return; 
        }
    }
});

/*
    Manejo de mensajes de usuarios externos (no en mi chat)
*/
client.on('message', async (msg) => {
    if (msg.fromMe || msg.from.includes('@g.us') || msg.from === 'status@broadcast') {
        return; 
    }

    const numeroLimpio = msg.from.split('@')[0];
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
        const estadoComando = estadoUsuariosActivos[numeroLimpio]?.paso;

        if (textoUsuario.startsWith('!')) {
            if (estadoComando) {
                delete estadoUsuariosActivos[numeroLimpio];
            }
            const nombreComando = textoUsuario.split(' ')[0].toLowerCase();

            if (comandos[nombreComando]) {
                await comandos[nombreComando].execute(msg, numeroLimpio, usuarioBD, estadoUsuariosActivos);
            } else if (nombreComando === '!ayuda') {
                await msg.reply('Bot: *Comandos de SmartPathAI:*\n\n!horapildora - Cambiar hora de estudio\n!carrera - Cambiar carrera\n!disciplina - Cambiar área\n!sesion - Iniciar estudio\n!progreso - Ver tus estadísticas');
            } else {
                await msg.reply('Bot: Ese comando no existe. Escribe *!ayuda* para ver las opciones.');
            }
            return; 
        }
            
        if (estadoComando) {
            if (textoUsuario.toLowerCase() === 'cancelar') {
                delete estadoUsuariosActivos[numeroLimpio];
                await msg.reply('Bot: Operación cancelada.');
                return;
            }

            if (estadoComando === 'ESPERANDO_NUEVA_HORA') {
                const regexHora = /^([01]\d|2[0-3]):([0-5]\d)$/; 
                if (!regexHora.test(textoUsuario)) {
                    await msg.reply('Bot: Formato incorrecto. Usa HH:MM (ejemplo: 08:00 o 15:30) o escribe *cancelar*.');
                    return;
                }
                await pool.execute(
                    'UPDATE usuario SET hora_pildora = ? WHERE numero_telefono = ?',
                    [textoUsuario, numeroLimpio]
                );
                    
                delete estadoUsuariosActivos[numeroLimpio]; 
                await msg.reply(`Bot: ¡Listo, ${usuarioBD.nombre}! He actualizado tu Píldora de Conocimiento para las *${textoUsuario}*.`);
                return; 
            }
        }

    } catch (dbError) {
        console.error('Error de base de datos:', dbError);
        await msg.reply('Bot: Lo siento, estoy teniendo problemas técnicos con mi base de datos. Intenta en unos minutos.');
        return;
    }

    if (msg.hasMedia) {
        console.log('Recibiendo archivo de un usuario externo...');
        try {
            const media = await msg.downloadMedia();

            if (media) {
                let rutaGuardado;
                if (media.filename) {
                    rutaGuardado = `./descargas/${media.filename}`;
                } else {
                    const numeroLimpio = msg.from.split('@')[0];
                    const extension = media.mimetype.split('/')[1].split(';')[0]; 
                    rutaGuardado = `./descargas/archivo_${numeroLimpio}_${Date.now()}.${extension}`;
                }
                const extension = rutaGuardado.split('.').pop().toLowerCase();
                fs.writeFileSync(rutaGuardado, media.data, 'base64');
                console.log(`Archivo guardado exitosamente en: ${rutaGuardado}`);

                if (extension === 'pdf') {
                    await msg.reply('Recibí tu PDF. Lo estoy leyendo, dame un segundo...');
                    
                    try {
                        let dataBuffer = fs.readFileSync(rutaGuardado);
                        let data = await pdf(dataBuffer);
                        let textoExtraido = data.text;
                        await msg.reply(`¡Lectura completada!\n\n Detalles del documento:\n- Páginas: ${data.numpages}\n- Caracteres: ${textoExtraido.length}\n\n Primeras palabras que leí:\n"${textoExtraido.substring(0, 150)}..."`);
                        const numeroLimpio = msg.from.split('@')[0];
                        await registrarInteraccion(numeroLimpio, media.filename || 'Documento PDF');
                    } catch (errorLeptura) {
                        console.error('Error al extraer texto del PDF:', errorLeptura);
                        await msg.reply('Pude guardar tu PDF, pero hubo un error al intentar leer su contenido de texto.');
                    }
                }
                else if (extension === 'txt') {
                        await msg.reply('Leyendo documento de texto...');

                        try {
                            let textoExtraido = fs.readFileSync(rutaGuardado, 'utf8');
                            
                            await msg.reply(`¡Lectura completada!\n\n Detalles del documento:\n- Caracteres: ${textoExtraido.length}\n\nPrimeras palabras que leí:\n"${textoExtraido.substring(0, 150)}..."`);
                            const numeroLimpio = msg.from.split('@')[0];
                            await registrarInteraccion(numeroLimpio, media.filename || 'Documento TXT');
                            
                        } catch (errorLectura) {
                            console.error('Error al leer el archivo TXT:', errorLectura);
                            await msg.reply('Pude guardar tu archivo TXT, pero hubo un error al intentar leerlo.');
                        }  
                }
                else if (extension === 'docx') {
                    await msg.reply(' Recibí tu documento de Word. Lo estoy extrayendo...');
                        
                    try {
                        const result = await mammoth.extractRawText({ path: rutaGuardado });
                        const textoExtraido = result.value; 
                        await msg.reply(`¡Lectura completada!\n\n Detalles del documento:\n- Caracteres: ${textoExtraido.length}\n\n Primeras palabras que leí:\n"${textoExtraido.substring(0, 150)}..."`);
                        const numeroLimpio = msg.from.split('@')[0];
                        await registrarInteraccion(numeroLimpio, media.filename || 'Documento DOCX');   
                    } catch (errorLectura) {
                        console.error('Error al extraer texto de Word:', errorLectura);
                        await msg.reply('Pude guardar tu archivo Word, pero hubo un error al intentar leer su contenido.');
                    }
                } 
                else if (extension === 'png' || extension === 'jpg' || extension === 'jpeg') {
                    await msg.reply('Recibí tu imagen. La he guardado en tu expediente para analizarla.');
                }
                // AUDIO PARA LUEGO
                // else if (extension === 'ogg' || extension === 'mp3' || extension === 'wav') {
                //     await msg.reply('Recibí tu nota de voz. Guardada en el expediente.');
                //     console.log(`Audio guardado listo para futura transcripción.`);
                // }  
                else {
                    await msg.reply(`Recibí tu archivo. Lo guardé con éxito.`);
                }
            }
        } catch (error) {
            console.error('Error al descargar el archivo:', error);
            await msg.reply('Hubo un problema al intentar descargar tu archivo.');
        }
        return; 
    }
});

client.initialize();