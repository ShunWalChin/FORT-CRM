# Arquitetura

> Federação de instâncias, isolamento físico, e a central que é projeção de um
> lado e livro do outro.

## A federação, em uma página

```
   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
   │  mp.db       │   │  af.db       │   │  ft.db       │
   │  Minas Peças │   │  Agrofort    │   │  Fort Tintas │
   └──────┬───────┘   └──────┬───────┘   └──────┬───────┘
          │                  │                  │
          └──────────┬───────┴─────────┬────────┴────────┐
                     │                 │                 │
          consulta federada      sincronização      colheita de fatos
          (ao vivo, para o       de leads           (venda fechou,
           painel do grupo)      (projeção)          OS entregou)
                     │                 │                 │
                     │                 ▼                 ▼
                     │        ┌────────────────────────────────┐
                     └───────►│          central.db            │
                              │                                │
                              │  leads_consolidados  PROJEÇÃO  │
                              │  (pode estar velha)            │
                              │  ────────────────────────────  │
                              │  erp_*               LIVRO     │
                              │  (fonte de verdade do grupo)   │
                              └────────────────────────────────┘
```

**Um arquivo, duas regras opostas — e é proposital.** A fronteira é o prefixo da
tabela. `leads_consolidados` é projeção: se discordar de uma instância, a
instância está certa. As tabelas `erp_*` são o contrário — ali a central é fonte
de verdade, porque partida dobrada exige transação e não existe transação que
atravesse três arquivos SQLite. Ver [ERP do grupo](ERP.md) para a decisão
completa e a direção do dado em cada sentido.

**Um banco por empresa.** O isolamento deixou de ser lógico e passou a ser
físico: não existe consulta mal escrita capaz de atravessar de uma empresa para
a outra, porque a linha da outra não está no arquivo. O escopo por
`empresa_id` continua em toda tabela — é a segunda barreira, e é o que permite
uma instância hospedar mais de uma empresa quando o cliente for pequeno demais
para pagar duas.

**Consulta simultânea sem `ATTACH`.** Ler várias empresas ao mesmo tempo
consulta cada instância e junta em memória. Seria mais curto usar `ATTACH
DATABASE`, mas isso amarraria a federação a "todos os bancos no mesmo disco" —
e o desenho previsto é o contrário: cada empresa numa instância que pode virar
outra VPS. Instância fora do ar aparece declarada como indisponível; nunca some
da conta em silêncio.

**Identidade federada, autorização por instância.** O token carrega o e-mail, e
cada instância diz se aquele e-mail entra. Não há diretório central de
identidade — seria justamente o ponto único de falha que a separação existe
para evitar.

---

## O que está implementado

| Área | O que existe |
|---|---|
| Federação | Três empresas em bancos separados, consulta simultânea, central consolidada |
| Aquisição | Atribuição de primeiro toque e conversão offline para Google Ads e Meta CAPI |
| Base de clientes | Busca, ficha completa, consentimento LGPD, descadastro, anti-duplicidade por telefone |
| Frota | Placa, sistema de injeção, KM/horímetro, projeção da próxima revisão |
| Ordens de serviço | Histórico técnico, conclusão com pressão medida, laudo digital imprimível |
| Pedidos | Itens, canal, ciclo de recompra, próximo contato |
| Pipeline | Kanban com arrastar; perda exige motivo |
| Régua de contato | 12 gatilhos, mensagem renderizada por cliente, compliance antes de exibir |
| Compliance | Nove checagens ordenadas, perfil por canal, rodapé de descadastro |
| Idempotência | Chave por gatilho/cliente/dia; repetição não reenvia |
| Auditoria | Append-only encadeado em SHA-256, com verificação |
| Importação | CSV com marcação de consentimento |

### Os doze gatilhos

**Minas Peças** — revisão de injeção (20.000 km, 15 dias de antecedência), filtro
de diesel (6 meses), preventiva de frota (escalonada), fim de garantia (30 dias
antes), orçamento parado (30 e 90 dias), pós-serviço (3 dias), pré-safra
(sazonal).

**Agrofort** — recompra por ciclo, reativação (90 dias), campanha sazonal,
follow-up de revenda (45 dias), boas-vindas ao primeiro pedido.

A regra é código; o texto é dado. Em **Gatilhos da régua** dá para reescrever
qualquer mensagem e ligar ou desligar o gatilho sem tocar no sistema.

---

## Estrutura

```
server.mjs           HTTP, roteamento, arquivos estáticos
src/federacao.mjs    Catálogo de instâncias e consulta federada
src/central.mjs      Consolidação de leads e entrada externa
src/atribuicao.mjs   Captura de gclid/fbclid, normalização e hash (puro)
src/conversoes.mjs   Payloads do Google Ads e da Meta CAPI (puro)
src/conversoes-servico.mjs  Fila, drenagem de eventos e despacho
src/schema.mjs       DDL do CRM de uma empresa
src/schema-extra.mjs DDL da federação, atribuição e conversão
src/reancorar.mjs    Desliza a linha do tempo da demonstração sem apagar nada
src/senha.mjs        scrypt, migração automática e política mínima
src/limite.mjs       Limite de requisições por origem
src/exportar.mjs     Exportação completa (código + dados + inventário)
src/db.mjs           Acesso com escopo obrigatório e cadeia de auditoria

── ERP do grupo, só na central ──
src/dinheiro.mjs     Centavos inteiros, conversão e rateio sem perda (puro)
src/erp-schema.mjs   DDL contábil + a decisão de arquitetura, escrita por extenso
src/razao.mjs        Partida dobrada, período, estorno, balancete, rateio
src/titulos.mjs      Contas a pagar e a receber, baixas e carteira
src/fatos.mjs        Colhe das instâncias e posta no razão, de forma idempotente
src/permissoes.mjs   Permissão por módulo — eixo ortogonal à escala de papel
src/compliance.mjs   Motor puro de elegibilidade (porte do Palantyr)
src/regua.mjs        Os 12 gatilhos e a projeção de revisão
src/api.mjs          Rotas
src/laudo.mjs        Laudo digital de bancada (HTML para impressão)
src/seed.mjs         Carga de demonstração, relativa à data de hoje
src/selftest.mjs     45 testes do CRM de uma empresa
src/selftest-fed.mjs 143 testes de federação, aquisição, cofre, campanha e oficina
web/manual.js        Manual didático embutido no sistema
web/telas-aquisicao.js  Central, conversões e origem dos leads
web/                 Interface — sem build, sem framework
deploy/instalar.sh   Instalação em Oracle Linux 9 aarch64, idempotente
deploy/              systemd, túnel e runbook para o servidor
ROADMAP.md           O que faz hoje e as 50 próximas implementações
```

Zero dependências de terceiros: `node:sqlite`, `node:http` e `node:crypto`.
Exige Node 22.5 ou superior.

### Variáveis

| Variável | Padrão | Para quê |
|---|---|---|
| `PORT` | `4501` | Porta |
| `HOST` | `127.0.0.1` | Interface de escuta |
| `DEMO_MODE` | `true` | `false` habilitaria efeitos externos — que ainda não existem |
| `FORTCRM_DIR` | `data/instancias` | Pasta com um banco por instância |
| `FORTCRM_SECRET` | aleatório por execução | Segredo do token. Aleatório significa que **reiniciar o servidor derruba as sessões abertas** — se estiver com o navegador aberto durante uma demonstração, fixe um valor |

---
