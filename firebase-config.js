// ⚠️ Preencha com as credenciais do SEU projeto Firebase
// (Console Firebase → Configurações do projeto → Seus apps → SDK setup)
//
// Se quiser reaproveitar um projeto Firebase que você já usa (ex.: o mesmo
// do Haimë ou do Plastnova), pode colar a mesma config aqui — cada app
// usa suas próprias coleções, então não há conflito de dados.
//
// Lembre-se também de:
// 1) Ativar "Email/Password" em Authentication → Sign-in method
// 2) Criar o Firestore Database (modo produção)
// 3) Ajustar as regras de segurança (sugestão no final deste arquivo)

const firebaseConfig = {
  apiKey: "SUA_API_KEY",
  authDomain: "SEU_PROJETO.firebaseapp.com",
  projectId: "SEU_PROJETO",
  storageBucket: "SEU_PROJETO.appspot.com",
  messagingSenderId: "SEU_SENDER_ID",
  appId: "SEU_APP_ID"
};

/*
Regras de segurança sugeridas (Firestore → Regras):

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
*/
