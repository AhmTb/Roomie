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
  filePath?: string;
  wasWritten: boolean;
}

interface StoreHostedImageParams {
  hosting: HostingConfig | null;
  url: string;
  projectId: string;
  label: HostedImageLabel;
  signal?: AbortSignal;
}

interface DeleteHostedImageParams {
  hosting: HostingConfig;
  asset: HostedAsset;
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
  expectedOwnerUserId: string;
  authorization: HostedProjectAuthorization;
  signal?: AbortSignal;
  commit: (project: DesignItem) => Promise<() => void>;
}

interface HostedProjectAuthorization {
  expectedOwnerUserId: string;
  accountVersion: string;
}

interface VisualizerNavigationState {
  version: 1;
  project: DesignItem;
  createdAt: number;
}
