# Cómo funcionaría en producción

La demo corre entera en un portátil. En producción son las mismas piezas (reglas, agentes, dial,
aprobaciones, trazas) repartidas en tres zonas con dueños distintos: **AWS** orquesta y razona,
el **CPD de HitSystems** sigue siendo la fuente de verdad y la **tienda** vende sin depender de AWS.

## 1. Flujo general

```mermaid
flowchart TD
    subgraph IN["Entradas · CPD de HitSystems"]
        E1["sanPedro<br/>estado de dispositivos,<br/>errores, sync"]
        E2["SQL Server<br/>tickets"]
        E3["Asterisk<br/>llamadas"]
        E4["ERP<br/>facturas · por confirmar"]
    end

    subgraph AWS["AWS · eu-west-1"]
        EB["EventBridge<br/>entrada única"]
        RULES{"Reglas deterministas<br/>coste 0"}
        OK["Resuelto sin IA<br/>la mayoría de casos"]
        SF["Agente<br/>SQS → Step Functions → Lambda"]
        LLM["Claude en Amazon Bedrock"]
        PG{"Policy Gate<br/>el dial"}
        APR["Pide permiso<br/>una persona aprueba en la consola"]
        LOG["Solo observa / Bloquea / Escala<br/>queda en la traza"]
        TG["Tool Gateway<br/>único que sale de AWS"]
    end

    subgraph OUT["CPD → tienda"]
        SP["sanPedro<br/>API de agentes v1"]
        TPV["Tienda<br/>tocGame y dispositivos"]
    end

    subgraph CODE["Arreglos de código"]
        GH["PR en GitHub"]
        HUM["Una persona revisa y fusiona"]
        CI["Release habitual de HitSystems"]
    end

    E1 & E2 & E3 & E4 --> EB
    EB --> RULES
    RULES -->|"lo resuelve una regla"| OK
    RULES -->|"hace falta criterio"| SF
    SF <-->|"razona"| LLM
    SF -->|"quiere actuar"| PG
    PG -->|"Hace sola / Hace y avisa"| TG
    PG --> APR
    APR -->|"aprobado"| TG
    PG --> LOG
    TG -->|"VPN sitio a sitio"| SP
    SP -->|"socket + API · ya existe"| TPV
    SF -->|"bug confirmado con tests"| GH
    GH --> HUM
    HUM --> CI
    CI -->|"versión nueva"| SP
```

**Cómo leerlo.** Todo entra por un único sitio (EventBridge), y cada paso queda en la traza del caso
con su coste. Las reglas absorben el volumen
con coste 0: reiniciar un datáfono bloqueado no necesita IA. Solo lo que requiere criterio pasa a
un agente, y cada acción del agente pasa por el Policy Gate, que decide según el dial si la hace
sola, la hace y avisa, pide permiso, solo la registra o la bloquea. Los agentes no tocan la red: todo sale
por el Tool Gateway, por VPN, hacia la API de agentes de sanPedro, que ya habla con cada tienda.

## 2. Ejemplo: un datáfono bloqueado

```mermaid
sequenceDiagram
    autonumber
    participant T as Tienda (tocGame)
    participant SP as sanPedro
    participant R as Reglas
    participant A as Agente de dispositivos
    participant P as Policy Gate
    participant H as Persona
    participant C as Agente de código
    participant G as GitHub

    T->>SP: El datáfono no responde
    SP->>R: Evento de estado de dispositivo
    alt Primer bloqueo y sin cobro en curso
        R->>SP: Reiniciar datáfono (coste 0)
        SP->>T: Reinicio, operativo en segundos
    else Se repite 3 veces en una hora
        R->>A: Abre caso: hace falta criterio
        A->>SP: Historial y estado de la flota
        A->>P: Pedir visita de técnico
        P->>H: Pide permiso (cuesta dinero)
        H-->>P: Aprobado
        P->>SP: Parte de técnico creado
    else Mismo fallo en varias tiendas con la misma versión
        R->>A: Ola de bloqueos
        A->>C: Posible bug en esa versión
        C->>C: Lee el código, reproduce con tests, arregla
        C->>G: Abre PR con los tests en verde
        H->>G: Revisa y fusiona
        G->>SP: Release por el proceso habitual
        SP->>T: Versión nueva en las tiendas
    end
```

## 3. Añadir un agente nuevo

```mermaid
flowchart TD
    A["Persona de negocio<br/>describe el agente<br/>en la consola"] --> B["Agente creador<br/>escribe manifiesto,<br/>prompt y herramientas"]
    B --> C["PR en GitHub"]
    C --> D["CI: validación,<br/>tests de contrato<br/>de herramientas y evals"]
    D -->|"no pasa"| B
    D -->|"pasa"| E["Una persona<br/>revisa y fusiona"]
    E --> F["Pipeline de infraestructura<br/>Lambda + rol IAM propio<br/>+ alarmas + entrada en AppConfig"]
    F --> G["Arranca en<br/>Solo observa"]
    G --> H["Sube en el dial<br/>cuando las métricas<br/>lo justifican"]
```

Añadir un agente no toca el runtime: es una carpeta en `agents/`, sus herramientas y una entrada
en la infraestructura. En la demo el agente se carga en caliente al fusionar; en producción se
despliega como su propia Lambda, con su rol, su presupuesto y su límite de concurrencia, para que
un agente desbocado no deje sin capacidad a los demás.

## 4. El dial de autonomía

```mermaid
flowchart LR
    S["Solo observa<br/>registra, no ejecuta"] --> AP["Pide permiso<br/>una persona aprueba"]
    AP --> N["Hace y avisa<br/>ejecuta y notifica"]
    N --> AU["Hace sola"]
    X["Condiciones<br/>cobro en curso, hora punta,<br/>demasiados reintentos"] -.->|"solo pueden bajar o bloquear"| AP
```

Cada acción tiene un techo por defecto, que se puede ajustar por cliente o por tienda (por
ejemplo, 365 en «Pide permiso» mientras el resto va en «Hace sola»). Se cambia en caliente, sin
desplegar. Las condiciones solo pueden bajar ese techo o bloquear, nunca subirlo.

## 5. De la demo a producción

| En la demo | En producción |
|---|---|
| Servidor Node en un portátil | Lambda + Step Functions en eu-west-1 |
| API de Claude directa | Claude en Amazon Bedrock, con los datos en la UE |
| Eventos en memoria | EventBridge + SQS |
| `config/policies.yaml` | AppConfig: el dial se cambia en caliente |
| `data/state.json` | Base de datos gestionada para casos y trazas |
| Simulador de dispositivos | sanPedro, por su API de agentes v1 y VPN |
| Tickets de ejemplo | SQL Server de ticketing, a través del Tool Gateway |
| Carpeta `terminal-pagos/` | Repositorios reales de tocGame y sanPedro |
| Fusión detectada por sondeo | Webhook de GitHub + CI/CD con evals |
| Consola local | La misma consola, con acceso por usuario y rol |

## 6. Reglas que no cambian

- **Una panadería tiene que poder vender aunque AWS esté caído.** Nada de esto entra en el
  arranque ni en el camino de venta de tocGame.
- **Nada de alto volumen pasa por el modelo.** Primero reglas; la IA, solo para lo que queda.
- **Ningún agente fusiona ni despliega.** Abre PRs; fusiona una persona.
- **Toda acción pasa por el dial**, con el ámbito cliente → tienda → dispositivo en cada caso,
  política, presupuesto y traza.
- **Presupuesto por caso, por agente y por día**, con corte automático.

Pendiente de confirmar para cerrar el detalle: el ERP de facturación, el volumen mensual de casos
y si ya existe cuenta de AWS.
