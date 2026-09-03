# Campos personalizados

> Cada empresa define os campos de que precisa, sem alteração de código.
> Ideia adaptada do [CRM da Comp AI](https://github.com/trycompai/crm) (MIT).

A oficina de injeção quer saber o **tipo de bomba**. A fazenda de queijo quer a
**maturação preferida**. A loja de tintas quer a **metragem da obra**. Nenhum
dos três precisa dos campos dos outros — e um CRM que os obrigue a conviver com
a união dos três vira formulário de cadastro de banco.

---

## Um registro descreve os dois tipos de campo

A tabela `propriedades` descreve **tanto as colunas reais quanto as chaves
dentro do JSON**:

| `origem` | Descreve | Onde o valor mora |
|---|---|---|
| `sistema` | uma coluna real de `clientes` | a própria coluna |
| `custom` | um campo que a empresa criou | uma chave em `clientes.campos` |

A tela não sabe a diferença. Ela lê o registro e desenha.

É isso que faz **acrescentar um campo ao CRM ser uma linha de dado**, e não uma
alteração em quatro lugares — o formulário, a coluna da tabela, o filtro e a
ficha. Quatro lugares é quatro chances de esquecer um.

Campo de sistema tem `chave` e `tipo` **imutáveis**: mudá-los não renomeia a
coluna, só faz o registro mentir sobre a tabela. Deles, só `rotulo`,
`mostrar_na_tabela` e `ordem` são editáveis.

---

## JSON, e não entidade-atributo-valor

EAV é a resposta de manual e a errada aqui. Mostrar uma lista com oito campos
personalizados viraria **oito junções ou um pivô**, em toda página de toda
lista. Numa coluna JSON os valores vêm na **mesma linha que já foi lida**: zero
consulta a mais, escrita atômica.

O preço é não haver integridade referencial no valor. Ele é comprado de volta
por `validarCampos`, no servidor, em **toda escrita**.

> Sem essa validação, a coluna JSON vira depósito de lixo em seis meses. É a
> parte que decide se isto ainda é sustentável em dois anos.

### O que a validação faz

| Situação | O que acontece |
|---|---|
| `metragem: "não é número"` | **400**, com o nome do campo e o motivo |
| opção fora da lista | **400**, dizendo qual valor sobrou |
| campo obrigatório vazio | **400** |
| **chave desconhecida** | **descartada e reportada** — nunca gravada |
| `"287,5"` num campo numérico | aceito como `287.5` — é como se digita aqui |
| data com hora | guarda só o dia |

Chave desconhecida ser descartada **em silêncio** seria criar um vazamento
invisível: ninguém sabe que está lá, ninguém apaga, e ele sai no export. Por
isso ela volta como aviso na resposta, e a tela mostra.

---

## Tipos

`texto`, `texto_longo`, `numero`, `moeda`, `data`, `booleano`, `selecao`,
`multi_selecao`, `telefone`, `email`, `url`.

Escolha única e múltipla exigem **pelo menos duas opções** — com uma, não há o
que escolher.

---

## A chave

`^[a-z][a-z0-9_]{1,39}$`. Ela precisa sobreviver a virar nome de coluna, chave
de JSON e parâmetro de URL. Restringir agora é mais barato que descobrir depois
que um campo chamado `preço (R$)` quebra o filtro.

**Chaves reservadas** são recusadas: as colunas reais e as de controle. Uma
chave `nome` dentro do JSON gravaria uma cópia que a tela nunca leria — e os
dois valores divergiriam para sempre.

---

## Arquivar, nunca apagar

Remover um campo o marca como arquivado. **O valor continua gravado no JSON de
cada cliente.**

Apagar a definição faria o dado virar órfão ilegível: ninguém saberia mais o que
aquela chave era, e desarquivar traria tudo de volta com sentido.

Campo de sistema não pode ser removido — ele descreve uma coluna real.

---

## O que não copiei do original

Eles têm **um registro para a instalação inteira**, porque são um único tenant.

Aqui cada empresa é uma instância com banco próprio, então o registro é **por
empresa por construção**. Verificado por teste: o catálogo da Minas Peças não
pode conter `maturacao`, e o da Agrofort não pode conter `tipo_bomba`.

---

## Rotas

| Método | Rota | |
|---|---|---|
| `GET` | `/api/propriedades` | o registro da empresa ativa |
| `POST` | `/api/propriedades` | cria um campo |
| `DELETE` | `/api/propriedades/:id` | arquiva |
