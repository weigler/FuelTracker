# Tanque Cheio

Controle de abastecimento, consumo e gastos da moto e do carro — PWA estático (HTML/CSS/JS puro, sem build), com Firebase Auth + Firestore como backend, feito para rodar no GitHub Pages e ser instalado no celular, tablet ou computador.

## Funcionalidades

- **Login por e-mail e senha** (Firebase Authentication)
- **Veículos**: cadastro de múltiplos veículos (moto/carro), apelido, placa, capacidade do tanque (conforme o manual), combustíveis aceitos (opcional, também conforme o manual — filtra o seletor de combustível ao abastecer esse veículo), arquivar ou excluir
- **Abastecimentos**: km, litros, valor total, tipo de combustível (Gasolina, Gasolina Aditivada, Gasolina Premium, Etanol, Diesel S10), se foi tanque cheio
  - Dois jeitos de calcular: informe **litros + total** (calcula o R$/litro) ou, sem o cupom em mãos, informe **total pago no cartão + preço do litro anotado na bomba** (calcula os litros)
  - Aviso automático (não bloqueia) se os litros informados passarem da capacidade do tanque cadastrada
- **Painel do veículo (opcional)**: tempo de motor ligado no tanque (em horas e minutos), velocidade média e consumo informados pelo computador de bordo — o app calcula os mesmos valores a partir do km e litros e mostra os dois lado a lado, com o desvio percentual, pra você conferir
- **Importação por NFC-e**: escaneie o QR Code do cupom fiscal (pela câmera ou enviando uma foto) ou cole o código/URL manualmente, para preencher automaticamente valor total, data e o CNPJ do posto — veja limitações abaixo
- **Painel** com ponteiro de km/l médio, gasto do mês, preço médio, km rodados e litros
- **Gráficos**: consumo (km/l), preço do combustível e gasto mensal ao longo do tempo
- **Tema claro/escuro**, em Ajustes → Aparência (preferência salva no aparelho)
- **Backup e restauração no Firestore**, em Ajustes → Backup: "Criar backup agora" grava um snapshot dos seus veículos e abastecimentos numa coleção própria (`users/{uid}/backups`) — não é um arquivo, fica dentro da sua conta. A lista de backups mostra data/hora e quantidade de registros, com "Restaurar" (atualiza pelo mesmo ID, sem apagar nada) e excluir
- **Exportar relatório em PDF**, em Ajustes → Exportar PDF: filtra por período (semana, mês, tudo ou datas personalizadas), por veículo (um ou todos) — o filtro de combustível mostra só os tipos já usados por esse veículo — o PDF sai estilizado, com cabeçalho colorido, cards de resumo (gasto total, preço médio, km rodados, consumo médio), mini-gráficos de gasto por mês, consumo e preço do combustível ao longo do tempo, e a tabela detalhada dos abastecimentos
- **PWA instalável**, funciona offline para a interface (dados do Firestore precisam de internet)

## Estrutura de arquivos

```
tanque-cheio/
├── index.html          # estrutura da aplicação
├── styles.css           # tema visual (dashboard/gauge)
├── app.js                # toda a lógica: auth, Firestore, cálculos, gráficos, NFC-e
├── firebase-config.js   # credenciais do projeto Firebase (já preenchidas)
├── manifest.json         # manifesto do PWA
├── service-worker.js    # cache offline da interface
└── icons/                # ícones do app (192, 512, apple-touch, favicon)
```

## Configuração do Firebase

O projeto já está configurado para usar o Firebase `tanquecheio-2026` (veja `firebase-config.js`). No [console do Firebase](https://console.firebase.google.com/), confirme que:

1. **Authentication → Sign-in method** → "E-mail/senha" está ativado
2. **Firestore Database** → criado (modo produção)
3. **Firestore → Regras** → aplicadas as regras abaixo (também estão comentadas no fim do `firebase-config.js`):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

Cada usuário só enxerga e grava os próprios dados, em `users/{uid}/vehicles`, `users/{uid}/fuelups` e `users/{uid}/backups`. A regra com `{document=**}` já cobre as três — não precisa mexer nela ao adicionar a coleção de backups.

## Publicando no GitHub Pages

1. Suba todos os arquivos desta pasta para um repositório no GitHub (na raiz, ou em `/docs`)
2. Em **Settings → Pages**, selecione a branch e a pasta onde estão os arquivos
3. Acesse a URL gerada pelo GitHub Pages, crie sua conta na tela de login e comece a cadastrar seus veículos

Para instalar como app: abra o link no navegador do celular e use "Adicionar à tela inicial" (Android/Chrome) ou "Adicionar à Tela de Início" (iOS/Safari). No computador, o Chrome/Edge mostram um ícone de instalação na barra de endereço.

## Como funciona o cálculo de consumo

O app assume que, por padrão, todo abastecimento é feito com o tanque cheio (dá pra desmarcar em abastecimentos parciais). O km/l de um abastecimento é calculado como:

```
km/l = (odômetro atual − odômetro do último tanque cheio) ÷ (litros somados desde então)
```

O mesmo raciocínio vale para a velocidade média calculada, usando as horas de motor informadas em vez dos litros.

## Importação de NFC-e — como funciona e limitações

O QR Code impresso no cupom da NFC-e sempre traz a **chave de acesso de 44 dígitos**, da qual o app já extrai o **CNPJ do emitente** com certeza (são os dígitos 7 a 20 da chave). Em vários estados (modelo "QR Code offline", adotado desde 2019/2021), o próprio QR também carrega o **valor total** e a **data/hora de emissão** sem precisar consultar a internet, e o app tenta reconhecer esses campos.

**O que a leitura NÃO consegue trazer:** o detalhamento de itens da nota (litros abastecidos, preço por litro) não vem no QR Code — isso exigiria consultar o portal da Sefaz de cada estado, que não permite acesso direto do navegador (bloqueio de CORS) e frequentemente pede captcha. Por isso litros e odômetro continuam sendo preenchidos por você.

**Por que sempre aparece uma prévia para conferir:** o formato exato do QR varia de estado para estado e entre versões, então o valor detectado pode ocasionalmente vir errado ou não ser identificado. A prévia mostra o que foi lido antes de aplicar ao formulário — nunca é salvo direto, encaixando com o seu hábito de sempre conferir os valores.

## Notas técnicas

- Sem etapa de build — abre direto no navegador
- Firebase via SDK compat (script tags), Chart.js, jsQR e jsPDF (+ autoTable) via CDN
- `service-worker.js` cacheia apenas os arquivos da própria aplicação; chamadas ao Firestore nunca são cacheadas
- O tema (claro/escuro) é salvo no `localStorage` do aparelho — é uma preferência de interface, não fica no Firestore, então pode variar entre dispositivos
- **Correção importante:** classes como `.modal`, `.view` e `.auth-screen` definem `display: flex` explicitamente; sem uma regra `[hidden] { display: none !important; }`, essas classes venciam a regra padrão do navegador para o atributo `hidden`, fazendo telas "escondidas" (login, modais, abas) aparecerem por cima de tudo. Se você criar novos elementos com `display` explícito controlados por `hidden`, essa regra global já cobre — não precisa repetir por componente.
