# NEXA ERP — reglas para agentes

Leé `docs/01-analisis.md` antes de tocar el modelo de datos: cada decisión de
esquema está justificada ahí contra los documentos del cliente.

Dos reglas no negociables de este repo:

1. **Toda asunción que se toma para poder avanzar se escribe como pregunta abierta**
   en el `docs/03-plan-release-N.md` que corresponda, indicando quién la responde.
2. **El ledger de movimientos es la fuente de verdad del stock.** Ningún saldo se
   escribe sin su movimiento, y ambos van en la misma transacción.
