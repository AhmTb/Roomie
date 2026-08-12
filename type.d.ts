interface AuthState {
  isAuthReady: boolean;
  isAuthTransitioning: boolean;
  isSignedIn: boolean;
  userName: string | null;
  userId: string | null;
}
type AuthContext = AuthState & {
  refreshAuth: () => Promise<boolean>;
  getAuthSnapshot: () => AuthState;
  signIn: () => Promise<boolean>;
  signOut: () => Promise<boolean>;
};

type HostedImageLabel = "original" | "rendered";

interface HostingConfig {
  version: 1;
  ownerUserId: string;
  subdomain: string;
  rootDirectory: string;
  rootDirectoryUid: string;
}

interface HostedAsset {
  url: string;
}

interface StoreHostedImageParams {
  hosting: HostingConfig | null;
  url: string;
  projectId: string;
  label: HostedImageLabel;
  signal?: AbortSignal;
}
