# Guion de la demo (15 minutos)

Todo funciona con Claude real y los PRs son reales en GitHub. Los botones «Lanzar» están en el
**Director de demo** (panel lateral de la consola).

## Antes de empezar

1. `npm run demo` y abre http://localhost:4000.
2. En otra pestaña, el repositorio en GitHub: https://github.com/itsS4nty/test-agentic-dashboard
3. La demo arranca limpia. Si ya has probado algo, pulsa **Reiniciar demo** (no toca GitHub).

Cada agente tarda entre 10 segundos y un minuto. La demo completa cuesta unos 2 US$.

## 1 · Qué es (1 min)

**Pestaña:** Resumen.

> «Es una plataforma donde viven los agentes de HitSystems. Primero actúan reglas, que no cuestan
> nada; la IA entra solo cuando hace falta criterio. Cada acción pasa por un dial de autonomía y
> todo queda registrado: qué hizo, por qué y cuánto costó.»

## 2 · Datáfono bloqueado: lo resuelve una regla (1 min)

**Pestaña:** Dispositivos → **01 Datáfono bloqueado** → Lanzar.

Se bloquea, se reinicia solo y vuelve a «Operativo» en segundos. Abre el caso: coste 0.

> «Lo repetitivo no necesita IA. Esto lo hace una regla, siempre igual y gratis.»

## 3 · El dial (1,5 min)

**Pestaña:** El dial. Pon «Reiniciar un dispositivo» en **Solo observa** y vuelve a lanzar el 01.

Ahora no reinicia: deja escrito lo que habría hecho. Vuelve a ponerlo en **Hace sola**.

> «La autonomía se decide por acción, por cliente e incluso por tienda, y se cambia en caliente.
> Un agente nuevo empieza observando y sube cuando se lo gana.»

## 4 · La ola: del datáfono al PR en GitHub (4 min)

**Pestaña:** Dispositivos → **04 Ola de bloqueos tras la versión 2.14.2** → Lanzar.

1. Cinco datáfonos se bloquean en varias tiendas. Las reglas los reinician y detectan la ola.
2. El **agente de dispositivos** ve que todos tienen la versión 2.14.2 y reporta un posible bug.
3. El **agente de código** lee el código, reproduce el fallo con tests, lo arregla y abre un PR.
   **Pestaña Código:** tests antes (1 falla) y después (todos pasan), el diff y **Ver en GitHub**.
4. En GitHub, enseña el PR y pulsa **Merge pull request**.
5. En unos 10 segundos: el PR sale como fusionado y los datáfonos pasan a la versión 2.14.3.

> «Dos bucles: la regla mantiene las tiendas cobrando y los agentes quitan la causa. El agente abre
> el PR como un compañero más; fusionar es siempre decisión de una persona.»

## 5 · Facturas (1,5 min)

**Pestaña:** Facturas → **08 Revisar el lote de facturas de septiembre** → Lanzar.

Las reglas encuentran los errores evidentes (precios, IVA, duplicados) con coste 0. Solo 2 facturas
van al agente, las que necesitan criterio. Una ya está emitida: el agente no la toca y la escala.

> «La IA se paga solo donde aporta. Y aunque tenga razón, una factura emitida no la toca sola.»

## 6 · Soporte y seguridad (1,5 min)

**Pestaña:** Soporte → **10 Ticket con intento de manipulación** → Lanzar. Después, **11 Prueba de
fuego** → Lanzar.

Un ticket intenta engañar al agente para que emita un abono. El filtro lo detecta y el agente lo
trata como sospechoso. En la prueba de fuego se fuerza el abono: la política lo bloquea igual.

> «La seguridad no depende de que el modelo acierte: aunque se equivocara, el dial no le deja.»

## 7 · Crear un agente nuevo (3 min)

**Pestaña:** Crear agente → **Rellenar con un ejemplo** (pedidos del obrador) → **Crear agente**.

1. En unos 40 segundos la IA escribe el agente (manifiesto, instrucciones, herramientas) y la
   plataforma añade lo delicado: permisos de cada acción, variables y registro. Valida y abre el PR.
2. **Abrir en GitHub** → enséñalo → **Merge pull request**.
3. En unos 10 segundos el agente queda activo, sin reiniciar: aparece en Agentes y en El dial, con
   las lecturas en «Hace sola» y las escrituras en «Pide permiso».

> «Así crece la plataforma: negocio describe lo que quiere, la IA escribe el código y una persona
> lo aprueba. Nada entra sin revisar.»

## 8 · Cierre: cómo sería en producción (2 min)

**Pestaña:** Resumen (casos, cuántos sin intervención humana, coste total). Después, en GitHub,
abre **FLUJO-PRODUCCION.md**.

> «En producción son las mismas piezas en AWS: Claude en Bedrock con los datos en la UE, conectado a
> sanPedro por VPN. La tienda nunca depende de AWS. Siguiente paso: accesos a sanPedro, al SQL
> Server de tickets y al ERP, y empezar por una familia de agentes en modo observación.»

## Si algo falla

- **Un agente tarda:** sigue con otro paso y vuelve luego; el caso sigue su curso.
- **Algo se queda raro:** **Reiniciar demo** (dos clics).
- **Sin tiempo:** salta el 3, el 5 o el 6. El 4 y el 7 son los importantes.

## Después de la reunión

Para repetir la demo, en GitHub pulsa **Revert** en el PR del arreglo del datáfono (si no, `main`
ya lleva el arreglo y el siguiente PR no tendría nada que cambiar).
