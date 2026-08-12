interface AuthState {
  isAuthReady: boolean;
  isSignedIn: boolean;
  userName: string | null;
  userId: string | null;
}
type AuthContext = {
  isAuthReady: boolean;
  isSignedIn: boolean;
  userName: string | null;  
  userId: string | null;
  refreshAuth: () => Promise<boolean>;
  signIn: () => Promise<boolean>;
  signOut: () => Promise<boolean>;
}
