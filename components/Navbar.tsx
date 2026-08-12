import { Box } from "lucide-react";
import { useOutletContext } from "react-router";
import Button from "./UI/button";

const Navbar = () => {
  const {
    isAuthReady,
    isAuthTransitioning,
    isSignedIn,
    userName,
    signOut,
    signIn,
  } =
    useOutletContext<AuthContext>();

  const handleAuthClick = async () => {
    if (!isAuthReady || isAuthTransitioning) return;

    try {
      if (isSignedIn) {
        await signOut();
      } else {
        await signIn();
      }
    } catch (error) {
      console.error("Error updating authentication:", error);
    }
  };

  return (
      <header className="navbar">
        <nav className="inner">
          <div className="left">
            <div className="brand">
              <Box className="logo" />
              <span className="name">Roomie</span>
            </div>
            <ul className="links">
              <li><a href="#product">Product</a></li>
              <li><a href="#workflow">Workflow</a></li>
              <li><a href="#projects">Projects</a></li>
              <li><a href="#enterprise">Enterprise</a></li>
            </ul>
          </div>
          <div className="actions">
            {isSignedIn ? (
              <>
                <span className="greeting"> {userName ? `Hello, ${userName}!` : "Sign In!"}</span>
                <Button
                  onClick={handleAuthClick}
                  className="btn"
                  disabled={!isAuthReady || isAuthTransitioning}
                >
                  {!isAuthReady
                    ? "Checking…"
                    : isAuthTransitioning
                      ? "Updating…"
                      : "Sign Out"}
                </Button>
              </>
            ) : (
              <>
                <Button
                  onClick={handleAuthClick}
                  size="sm"
                  variant="ghost"
                  disabled={!isAuthReady || isAuthTransitioning}
                >
                  {!isAuthReady
                    ? "Checking…"
                    : isAuthTransitioning
                      ? "Updating…"
                      : "Login"}
                </Button>
                <a href="#upload" className="cta">Get Started</a>

              </>
            )}

          </div>
        </nav >
      </header >
  );
};

export default Navbar;
