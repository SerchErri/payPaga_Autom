# Guía Rapida de Ejecución: Runner Matricial QA

Hemos migrado a un modelo de ejecución avanzado estilo Matrix (`npm run qa -- [flags]`), donde tú le dictas a NodeJS exactamente qué pedazo del proyecto quieres ejecutar usando banderas (`flags`). Esto elimina la necesidad de tener comandos infinitos en el `package.json`.

## La Anatomía del Comando
El comando base es:
```bash
npm run qa --
```
*(Nota: El `--` es obligatorio en NPM para inyectar flags custom hacia nuestro script `runner.js`)*.

### Parámetros / Banderas Soportadas

| Bandera | Valores Comunes | Descripción |
| :--- | :--- | :--- |
| `--env=` | `dev`, `stg` | Entorno que se inyectará al config. Si no pasas nada, usa `dev` por default. |
| `--country=` | `EC`, `PE`, `CO`... | País. Jest buscará archivos que contengan este prefijo de país. |
| `--module=` | `payin`, `payout` | Agrupa todo el universo de Cobros o Dispersiones. |
| `--product=` | `payurl`, `merchant`, `h2h` | Afina la mira hacia un producto en específico. |
| `--type=` | `flow`, `interactivity`, `api` | Afina la mira hacia un tipo de prueba específico. |
| `--report=` | `true`, `false` | Determina si al final se levanta visualmente la web Oscura de Allure (true) o si se queda mudo en consola (false). |
| `--smoke=` | `true` | *(Próximamente)* Para filtrar solo tests anotados o subcarpetas de Smoke. |
| `--sanity=` | `true` | *(Próximamente)* Para filtrar regresiones críticas. |

---

## 🚀 Ejemplos Útiles (Copia y Pega)

#### 1. Corrida Rápida (Consola Únicamente, Sin Reporte Web)
Ideal si estás apurado haciendo debug de un flujo feliz específico:
```bash
npm run qa -- --env=dev --module=payin --product=merchant --type=flow --country=EC --report=false
```

#### 2. Corrida Completa de Módulo para IC (Generando Visual)
Quiero probar ABSOLUTAMENTE TODO de tu país, del producto Payout UI, en ambiente DEV:
```bash
npm run qa -- --env=dev --module=payout --product=merchant --country=EC --report=true
```

#### 3. Correr Todas Las Interactividades Simultáneas
```bash
npm run qa -- --env=stg --type=interactivity --report=true
```

#### 4. Correr Absolutamente TODO el código
Simplemente no le pases ningún flag de filtrado (no modules, no tags):
```bash
npm run qa -- --env=dev --report=true
```

---
*Nota Técinica: El orden de los parámetros NO importa gracias al motor LookAround Regex integrado.*
