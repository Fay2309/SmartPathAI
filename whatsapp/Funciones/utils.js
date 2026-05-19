function calcularProgresion(puntajeActual, rachaActual, esCorrecto) {
    let nuevoPuntaje = puntajeActual;
    let nuevaRacha = rachaActual;
    let puntosCambiados = 0;

    if (esCorrecto) {
        // Bono por racha: +2 puntos extra por cada 10 días seguidos
        const bonoRacha = Math.floor(rachaActual / 10) * 2;
        puntosCambiados = 20 + bonoRacha; 
        
        nuevoPuntaje += puntosCambiados;
        nuevaRacha += 1;

        // Límite max de puntos
        if (nuevoPuntaje > 900) {
            nuevoPuntaje = 900;
        }
    } else {
        // Castigo por error: -15 puntos y se rompe la racha
        puntosCambiados = -15;
        nuevoPuntaje += puntosCambiados;
        nuevaRacha = 0; 

        // Límite min de puntos
        if (nuevoPuntaje < 0) {
            nuevoPuntaje = 0;
        }
    }

    return {
        nuevoPuntaje,
        nuevaRacha,
        puntosCambiados
    };
}

function obtenerRango(puntaje) {
    if (puntaje >= 900) return 'Referente mundial 👑';
    if (puntaje >= 850) return 'Investigador 🔬';
    if (puntaje >= 700) return 'Doctorado 🥼🩺';
    if (puntaje >= 550) return 'Maestría 👩‍🏫';
    if (puntaje >= 400) return 'Universitario 🎓';
    if (puntaje >= 250) return 'Estudiante de preparatoria 🥇';
    if (puntaje >= 100) return 'Estudiante de secundaria 🥈';
    return 'Estudiante de primaria 🥉'; 
}

async function registrarInteraccion(pool, numeroTelefono, nombreArchivo, textoExtraido) {
    try {
        const [usuarios] = await pool.execute('SELECT id_usuario FROM usuario WHERE numero_telefono = ?', [numeroTelefono]);
        
        if (usuarios.length > 0) {
            const idUsuario = usuarios[0].id_usuario;
            await pool.execute(
                `INSERT INTO interaccion_estudio 
                (id_usuario, tema_o_archivo, tipo_interaccion, estado, fecha_creacion, contenido) 
                VALUES (?, ?, 'REPASO_PROGRAMADO', 'PENDIENTE', NOW(), ?)`,
                [idUsuario, nombreArchivo, textoExtraido] 
            );
            console.log(`Repaso programado en BD para el archivo: ${nombreArchivo}`);
        } else {
            console.log(`Advertencia: No se encontró el usuario ${numeroTelefono}.`);
        }
    } catch (err) {
        console.error('Error al registrar la interacción en BD:', err);
    }
}

module.exports = { calcularProgresion, obtenerRango, registrarInteraccion };