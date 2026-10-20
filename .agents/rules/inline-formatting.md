# Regla de Formato en Línea sin Selección ("Sin Sombrear")

En este proyecto (Urano), cuando se aplica un formato (Negrita `**`, Cursiva `*`, Tachado `~~`, Código `` ` ``, Matemáticas `$`, Comentario `%%`, Resaltado `==` o Borrar formato) sin tener texto sombreado/seleccionado (`selection.empty`):

1. **Nunca** insertar delimitadores vacíos desconectados (como `****`, `**texto**`, `==texto==`) si existe texto o una palabra detrás o debajo del cursor.
2. Si el cursor está sobre o inmediatamente detrás de una palabra (ej: `suu|`, `s|uu`, o tras espacios `suu |`), el editor detecta automáticamente dicha palabra previa (`[\p{L}\p{N}_]+\s*$`) y le aplica el formato (`**suu**`, `*suu*`, `==🔴suu==`, etc.).
3. Si la palabra detectada ya contiene ese formato, se desenvuelve (toggle off / unwrap).
4. Si la selección está vacía sobre o tras un token formateado y se invoca "Borrar formato", se limpian los delimitadores de esa palabra/token.
5. Únicamente si el cursor se encuentra en una línea vacía o sin ninguna palabra/texto previo en la línea activa, se inserta el par de delimitadores con el cursor en el centro para permitir comenzar a escribir con formato.
