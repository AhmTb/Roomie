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

type HostedImageLabel = "source" | "rendered";

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

// Project record visibility is separate from public Puter-hosted asset access.
type ProjectVisibility = "private" | "public";
type HostedAssetAccess = "public-hosted";

interface DesignItem {
  id: string;
  name: string;
  sourceImage: string;
  renderedImage?: string;
  timestamp: number;
  ownerId: string;
  visibility: ProjectVisibility;
  assetAccess: HostedAssetAccess;
  sourcePath: string;
  renderedPath?: string;
  publicPath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

type CreateProjectItem = Pick<
  DesignItem,
  | "id"
  | "name"
  | "sourceImage"
  | "renderedImage"
  | "timestamp"
  | "fileName"
  | "fileSize"
  | "mimeType"
>;

interface CreateProjectParams {
  item: CreateProjectItem;
  visibility: ProjectVisibility;
  signal?: AbortSignal;
}

interface VisualizerNavigationState {
  version: 1;
  project: DesignItem;
  createdAt: number;
}
