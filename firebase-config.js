// Configuração do projeto Firebase "tanquecheio-2026"
//
// Lembre-se de:
// 1) Ativar "Email/Password" em Authentication → Sign-in method
// 2) Criar o Firestore Database (modo produção)
// 3) Aplicar as regras de segurança sugeridas no final deste arquivo

const firebaseConfig = {
  apiKey: "AIzaSyDHfm1mZsD3mCHaFOdQ4DGLGffCrdgdGqo",
  authDomain: "tanquecheio-2026.firebaseapp.com",
  projectId: "tanquecheio-2026",
  storageBucket: "tanquecheio-2026.firebasestorage.app",
  messagingSenderId: "408420948007",
  appId: "1:408420948007:web:fdbfefc4f6db98dd1e5602"
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
