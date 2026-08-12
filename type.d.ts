interface AuthState {
  isAuthReady: boolean;
  isAuthTransitioning: boolean;
  isSignedIn: boolean;
  userName: string | null;
  userId: string | null;
}
type AuthContext = {
  isAuthReady: boolean;
  isAuthTransitioning: boolean;
  isSignedIn: boolean;
  userName: string | null;  
  userId: string | null;
  refreshAuth: () => Promise<boolean>;
  getAuthSnapshot: () => AuthState;
  signIn: () => Promise<boolean>;
  signOut: () => Promise<boolean>;
}
