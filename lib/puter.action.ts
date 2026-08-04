import puter from "@heyputer/puter.js";

export const signIn = async () => await puter.auth.signIn();

export const signOut = async () => await puter.auth.signOut();

export const getCurrentUser = async () => {
  try {
    return await puter.auth.getUser();
  } catch (error) {
    console.error("Error getting current user:", error);
    return null;
  }
};
