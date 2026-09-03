# FORT-CRM — o que faz hoje e o que vem depois

Documento de referência do produto. Primeira parte: tudo que o sistema já faz,
como inventário honesto. Segunda parte: as próximas cinquenta implementações,
em fila e com dependências declaradas.

---

# PARTE 1 — O que o sistema faz hoje

## 1.1 A ideia central

O sistema responde a uma pergunta que planilha nenhuma responde:
**com quem eu preciso falar hoje, e por quê?**

Guardar cadastro é o mínimo. O que muda a receita é o sistema perceber sozinho
que o caminhão do Antônio está chegando na revisão, escrever a mensagem com
placa e quilometragem, e **recusar o envio** quando enviar seria errado.

## 1.2 Federação de instâncias

Três empresas, **três bancos de dados separados**, mais uma instância central
que consolida os leads de todas as fontes.

| Recurso | Estado |
|---|---|
| Um banco por empresa — isolamento físico, não só lógico | Funcionando, verificado por teste |
| Consulta simultânea a várias instâncias, com carimbo de origem | Funcionando |
| Instância fora do ar é declarada, nunca some da conta | Funcionando, verificado por teste |
| Identidade federada por e-mail, autorização por instância | Funcionando |
| Central: projeção de leitura, sincronização idempotente | Funcionando, verificado por teste |
| Troca de empresa em um clique | Funcionando |
| Cor da interface muda com a empresa ativa | Funcionando |
| Usuário só enxerga as empresas do seu vínculo | Funcionando, verificado por teste |
| Servidor recusa acesso cruzado com HTTP 403 | Funcionando, verificado por teste |
| Visão consolidada do grupo, com motivo registrado | Funcionando |
| Menu muda conforme o negócio (oficina tem frota, fazenda tem pedido) | Funcionando |

A fronteira é o `empresa_id`, presente em toda tabela. Consulta sem contexto de
empresa é recusada pela camada de acesso, não pela interface.

## 1.3 Base de clientes

- Busca por nome, telefone ou e-mail, filtrando enquanto digita
- Ficha completa: dados, veículos, ordens de serviço, pedidos, oportunidades e
  linha do tempo unificada
- Anti-duplicidade: telefone repetido é recusado com o nome de quem já existe
- Consentimento LGPD por contato, com data
- Descadastro que bloqueia toda automação, sem exceção
- Perfis: particular, frota, produtor rural, revenda, consumidor
- Importação de CSV com marcação de consentimento

## 1.4 Frota e injeção — a oficina

- Ficha por placa: marca, modelo, ano, motorização, sistema de injeção
- Seis tipos de sistema (Common Rail CP3 e CP4, bomba mecânica, rotativa,
  UIS/UPS, injeção eletrônica)
- Quilometragem e horímetro
- **Projeção da próxima revisão** pela média de rodagem entre passagens
- Semáforo: verde com folga, amarelo perto, vermelho vencido
- Veículo sem média fica marcado "sem projeção" — o sistema não chuta

## 1.5 Ordens de serviço e laudo digital

- Histórico técnico: componente, bancada usada, pressão medida, peça, garantia
- Conclusão de OS registrando a pressão da bancada
- **Laudo digital de bancada**: documento com identificação do veículo, ensaio,
  parecer técnico, condições de garantia e assinatura, pronto para PDF
- O laudo exige sessão válida — link solto não abre

## 1.6 Pedidos e recompra — a fazenda

- Pedido com itens, canal de origem e valor
- Ciclo de recompra por produto
- Data do próximo contato calculada automaticamente
- Funil separado para revenda, que tem ticket e conversa diferentes

## 1.7 Pipeline

- Kanban de seis etapas, com arrastar e soltar
- Valor total e valor ponderado pela probabilidade
- **Perda exige motivo** — o sistema não deixa fechar sem
- O motivo vira o dado que ensina o que corrigir

## 1.8 Régua de contato — o coração

Dezessete gatilhos: sete da oficina, cinco da fazenda e cinco da loja de tintas.

| Oficina | Quando dispara |
|---|---|
| Revisão de injeção | 20.000 km, avisando 15 dias antes |
| Filtro de diesel | 6 meses desde a última passagem |
| Preventiva de frota | Mensal, escalonada por veículo |
| Fim de garantia | 30 dias antes de vencer |
| Orçamento parado | 30 e 90 dias sem andar |
| Pós-serviço | 3 dias após a entrega |
| Pré-safra | Sazonal, para produtor rural |

| Fazenda | Quando dispara |
|---|---|
| Recompra por ciclo | Passado o ciclo do produto |
| Reativação | 90 dias sem pedido |
| Campanha sazonal | Dia das Mães, festa junina, Natal |
| Follow-up de revenda | 45 dias sem reposição |
| Boas-vindas | 2 dias após o primeiro pedido |

| Loja de tintas | Quando dispara |
|---|---|
| **Obra parada no meio** | Comprou massa/selador e não voltou para a tinta em 12 dias |
| Recompra por ciclo | Passado o ciclo do item comprado |
| Reposição de profissional | Pintor ou empreiteira 40 dias sem passar |
| Pós-venda de obra | 15 dias após compra acima de R$ 500 |
| Orçamento parado | 21 dias sem andar |

O gatilho de **obra parada** é o mais específico do nicho: numa loja de tintas
a sequência da obra é massa corrida, selador e só então tinta. Quem comprou o
começo e não voltou está prestes a comprar tinta — de nós ou da esquina.

Para cada candidato o sistema monta a mensagem com nome, placa, modelo,
quilometragem e data — e trata empresa pela razão social e pessoa pelo primeiro
nome. Um gatilho fala uma vez por contato por ciclo: cliente com três caminhões
gera uma linha, não três.

## 1.9 Compliance de mensageria

Nove checagens em ordem fixa. A ordem decide qual motivo fica auditado quando
mais de um bloqueio se aplica:

1. Canal desconectado
2. Descadastro (opt-out)
3. Consentimento LGPD ausente
4. Termo bloqueado no corpo final
5. Teto de caracteres do canal
6. Nenhuma interação recebida do contato
7. Cooldown do gatilho
8. Dentro da janela de 24 horas → liberado
9. Fora da janela: só template aprovado, e só onde o canal aceita

Perfil por canal: Instagram e WhatsApp Cloud têm janela imposta pela Meta;
Evolution não tem janela técnica, mas a regra vale igual — o que pune o excesso
ali não é erro de API, é o banimento do número.

Toda mensagem automática termina com "Responda PARAR".

## 1.10 Envio idempotente

Cinco estados: `claimed`, `sent`, `blocked`, `unknown`, `failed`.

A intenção é gravada antes de tocar a rede. Chave por gatilho, cliente e dia:
disparar duas vezes a mesma seleção não manda duas mensagens. Resposta ambígua
vira `unknown` e **nunca** recebe repetição automática — mensagem atrasada se
explica, mensagem duplicada não se desfaz.

## 1.11 Governança

- Auditoria append-only encadeada em SHA-256, com verificação de integridade
- Banco recusa alteração e exclusão de registro de auditoria
- Leitura consolidada do grupo exige motivo textual, que fica registrado
- Modo demonstração: nada sai para número real

## 1.11-b Aquisição e conversão offline

- Captura de `gclid`, `gbraid`, `wbraid`, `fbclid` e UTM no momento da entrada
- Primeiro toque gravado uma vez e nunca reescrito
- Identificadores em SHA-256, normalizados no formato de **cada** plataforma
- Mudança de etapa no funil vira evento; worker drena e enfileira a conversão
- Payload real do Google Ads (ClickConversion) e da Meta CAPI, conferível na tela
- Compliance próprio: destino, consentimento, identificador e valor, em ordem fixa
- Resposta ambígua vira `desconhecido` e nunca é repetida sozinha

## 1.12 Operação do sistema

- Manual didático embutido, com tour de tela, receitas e glossário
- Recarga da demonstração em um clique
- Exportação completa: código, dados em CSV e JSON, banco, inventário com
  SHA-256 e manifesto
- Limite de requisições por origem, com tetos diferentes por rota
- 77 testes automatizados que rodam sem instalar nada

---

# PARTE 2 — As próximas 50 implementações

Ordenadas por bloco. Dentro de cada bloco, por dependência.

**Esforço:** P = até 2 dias · M = até 1 semana · G = mais de 1 semana.

---

> **Atualização de 03/09/2026.** A federação de instâncias e o circuito de
> conversão offline foram implementados e saíram desta fila. O que entrou está
> descrito no README; o que sobrou continua abaixo, com a numeração original
> preservada para não quebrar referência em conversa. Itens concluídos ficam
> marcados, não apagados — sumir com o item apaga também a decisão de tê-lo
> feito.

### Concluído desde a primeira versão

| # | Implementação | Como ficou |
|---|---|---|
| — | **Três instâncias, um banco por empresa** | `MP`, `AF` e `FT`, mais a `CENTRAL`. Isolamento passou de lógico a físico |
| — | **Consulta simultânea entre instâncias** | Federação consulta cada banco e junta em memória; instância fora do ar é declarada, não some |
| — | **Central de leads de todas as fontes** | Projeção de leitura, sincronização idempotente, porta de entrada externa |
| — | **Fort Tintas como terceira empresa** | Nicho de varejo, catálogo próprio e cinco gatilhos de loja de tintas |
| — | **Atribuição de anúncio** | `gclid`/`gbraid`/`wbraid`/`fbclid`/UTM em primeiro toque, nunca reescrito |
| — | **Conversão offline (OCI + CAPI)** | Payload real das duas plataformas, com hash normalizado por plataforma |
| 37 | Metas por período | Parcial: o painel do grupo já consolida, falta a meta declarada |
| 40 | **Análise de motivo de perda** | O dado já era coletado; agora vira evento de conversão perdida |


## Bloco A — Tirar do protótipo (1 a 10)

Nada aqui é opcional para cobrar mensalidade. É o que separa demonstração de
produto.

| # | Implementação | Por que agora | Esf. | Depende de |
|---|---|---|---|---|
| 1 | **Definir o perfil do número de WhatsApp** — Cloud API oficial ou Baileys | O perfil de política muda tudo no compliance. Decidir antes de codar o adaptador | P | Decisão do Soberano |
| 2 | **Adaptador de envio WhatsApp** | É o único ponto que transforma a régua em receita | M | 1 |
| 3 | **Webhook de recebimento** | Sem receber mensagem, a janela de 24h nunca abre e a régua bloqueia tudo | M | 1 |
| 4 | **Hash de senha e política mínima** | Hoje a senha é texto claro. Impensável com dado real | P | — |
| 5 | **Sessão revogável, com expiração e logout global** | Demissão de funcionário hoje não corta acesso | P | 4 |
| 6 | **Papéis aplicados no servidor** | O papel existe no cadastro mas não restringe nada | M | 5 |
| 7 | **Migrar para PostgreSQL com RLS** | Com uma instância por empresa o isolamento já é físico; a RLS passa a valer para o caso de uma instância hospedar duas empresas | G | — |
| 8 | **Worker de agenda** | Hoje a régua só calcula quando alguém abre a tela. Precisa rodar de madrugada | M | 7 |
| 9 | **Fila de `unknown` com dono e rito diário** | Toda resposta ambígua é uma mensagem que talvez tenha ido ao cliente | P | 2 |
| 10 | **Backup automático com restauração testada** | Backup nunca restaurado não é backup | M | 7 |

## Bloco B — Operação diária (11 a 20)

O que a equipe vai pedir na primeira semana de uso.

| # | Implementação | Por que | Esf. | Depende de |
|---|---|---|---|---|
| 11 | **Cadastro e edição de veículo pela tela** | Hoje só dá para atualizar KM via API | P | — |
| 12 | **Abrir ordem de serviço pela tela** | Hoje a OS só nasce na carga | P | — |
| 13 | **Registrar pedido pela tela** | Mesma lacuna, do lado da fazenda | P | — |
| 14 | **Edição do catálogo** | Preço muda e ninguém quer chamar o suporte | P | — |
| 15 | **Atualização de KM em lote** | Na visita o atendente atualiza vários de uma vez | P | 11 |
| 16 | **Busca global (Ctrl+K)** | Achar cliente, placa ou OS sem navegar | M | — |
| 17 | **Agenda de bancada** | A oficina tem 8 equipamentos e precisa marcar horário | G | 12 |
| 18 | **Anexos: foto da peça e nota fiscal** | O laudo fica muito mais forte com a foto | M | 12 |
| 19 | **Assinatura do cliente no laudo** | Fecha o ciclo de prova de serviço | M | 18 |
| 20 | **Aplicativo instalável (PWA) com uso offline** | Oficina tem ponto cego de sinal; fazenda, mais ainda | G | — |

## Bloco C — Canais e integrações (21 a 28)

| # | Implementação | Por que | Esf. | Depende de |
|---|---|---|---|---|
| 21 | **Caixa de entrada dentro do CRM** | Hoje a conversa vive no celular e o histórico se perde | G | 3 |
| 22 | **Instagram Direct** | A fazenda vende muito por ali | M | 3 |
| 23 | **Templates aprovados na Meta** | É o que permite falar fora da janela de 24h | M | 2 |
| 24 | **Envio de mídia pelo canal** | Mandar o PDF do laudo direto, sem baixar e anexar à mão | M | 2, 18 |
| 25 | **Formulário do site direto no CRM** | Hoje o lead do site vira mensagem solta | P | — |
| 26 | **Clique-para-WhatsApp com rastreio de origem** | Saber qual página gerou o contato | P | 25 |
| 27 | **Google Meu Negócio: avaliações** | Puxar avaliação e responder de dentro do sistema | M | — |
| 28 | **E-mail transacional como alternativa** | Nem todo cliente tem WhatsApp ativo | M | — |

## Bloco D — Inteligência (29 a 36)

Só depois que houver conversa real acumulada. Antes disso, não há o que aprender.

| # | Implementação | Por que | Esf. | Depende de |
|---|---|---|---|---|
| 29 | **Classificação de intenção da conversa** | Orçamento, agendamento, dúvida, garantia, emergência | M | 21 |
| 30 | **Resumo automático do atendimento** | O atendente seguinte entra sabendo o que aconteceu | M | 21 |
| 31 | **Sugestão de próxima ação por cliente** | Transforma histórico em recomendação | M | 29 |
| 32 | **Alerta de cliente sumindo** | Detectar queda de frequência antes da perda | M | — |
| 33 | **Score de oportunidade no pipeline** | Priorizar quem tem mais chance de fechar | M | 40 |
| 34 | **Detecção inteligente de duplicidade** | Nome parecido e telefone diferente hoje passa batido | P | — |
| 35 | **Enriquecimento por placa** | Preencher marca, modelo e ano sozinho | P | 11 |
| 36 | **Orçamento assistido por sintoma** | Do sintoma à lista de peças e mão de obra | G | 14, 29 |

## Bloco E — Gestão e relatórios (37 a 43)

| # | Implementação | Por que | Esf. | Depende de |
|---|---|---|---|---|
| 37 | **Metas por período** | Sem meta, painel é enfeite | P | — |
| 38 | **Relatório mensal em PDF automático** | É entregável contratual da proposta | M | 37 |
| 39 | **Produtividade por atendente** | Quem atende, quanto converte, em quanto tempo | M | 6 |
| 40 | **Análise de motivo de perda** | O dado já é coletado e ninguém lê | P | — |
| 41 | **Curva ABC de clientes** | Descobrir os 20% que sustentam o negócio | P | — |
| 42 | **Faturamento por serviço e por produto** | Saber o que dá dinheiro de verdade | M | — |
| 43 | **Exportação agendada** | A exportação existe; falta rodar sozinha e guardar fora | P | 10 |

## Bloco F — Plataforma e escala (44 a 50)

O que transforma um sistema de um cliente em produto vendável a muitos.

| # | Implementação | Por que | Esf. | Depende de |
|---|---|---|---|---|
| 44 | **Criar empresa pela tela** | Hoje nasce empresa só na carga; sem isso não há cliente número dois | M | 7 |
| 45 | **White-label por empresa** | Logo, cor e domínio próprios por cliente | M | 44 |
| 46 | **Portal do cliente final** | O motorista vê seus laudos e o histórico do veículo | G | 19, 45 |
| 47 | **API pública com token por escopo** | Integrar com o que o cliente já usa | M | 6 |
| 48 | **Webhooks de saída** | Avisar outros sistemas quando algo acontece | M | 47 |
| 49 | **Âncora externa da cadeia de auditoria** | Hoje a cadeia detecta adulteração mas não impede | M | 7 |
| 50 | **Notificação push e app nativo** | A régua chega ao dono no celular, sem depender de abrir a tela | G | 20 |

---

## Bloco G — O que a federação e a conversão abriram (51 a 58)

Itens que não existiam na primeira fila porque as funcionalidades que os exigem
ainda não tinham sido construídas.

| # | Implementação | Por que | Esf. | Depende de |
|---|---|---|---|---|
| 51 | **Adaptador de rede do Google Ads** | O payload já é montado e conferido; falta a chamada autenticada e o refresh de token | M | 01 |
| 52 | **Adaptador de rede da Meta CAPI** | Idem, mais o `test_event_code` para validar antes de ligar de verdade | M | 01 |
| 53 | **Landing page que captura o clique** | É a lacuna que o sistema de referência declarava: sem LP guardando `gclid`, o caminho do WhatsApp não fecha | M | — |
| 54 | **Fila de conversão `desconhecido` com dono** | Mesma disciplina da fila de mensagens: ambiguidade exige olho humano no mesmo dia | P | 51, 52 |
| 55 | **Worker de sincronização da central** | Hoje sincroniza na subida e sob demanda; precisa de cron com janela e retomada | P | 08 |
| 56 | **Roteamento automático do lead externo** | A central já recebe e guarda; falta a regra que decide de quem é sem alguém dizer | M | — |
| 57 | **Instância remota (outra VPS)** | A federação já foi escrita para isso — falta o transporte HTTP no lugar do acesso a arquivo | G | 07 |
| 58 | **Painel de retorno por campanha** | Juntar custo de mídia com ganho do funil e fechar o ROAS real por campanha | M | 51, 52 |

---

## Ordem sugerida de ataque

**Primeiro trimestre — cobrar com segurança.** Bloco A inteiro, mais os itens
11 a 14 do Bloco B. Ao fim disto o sistema envia mensagem real, com senha
protegida, isolamento garantido pelo banco e a equipe conseguindo trabalhar sem
chamar o suporte.

**Segundo trimestre — ficar indispensável.** Restante do Bloco B, mais 21, 23,
25 e 26. A conversa passa a morar no sistema, e é aí que ninguém troca mais.

**Terceiro trimestre — provar valor.** Bloco E inteiro, mais 27 e 32. O cliente
passa a ver número, e renovação de contrato deixa de ser conversa difícil.

**Quarto trimestre — virar produto.** Bloco F, mais o que sobrou do D. Aqui o
sistema deixa de ser de um cliente e passa a ser vendável em série.

---

## O critério que vale mais que a lista

Nenhum item acima importa se a régua não estiver disparando todo dia e alguém
não estiver respondendo. **A medida de sucesso é o percentual da base que
recebeu contato no mês e a taxa de retorno disso** — não a quantidade de
funcionalidade entregue.
