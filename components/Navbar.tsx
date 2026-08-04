import { Box } from "lucide-react";
import { useOutletContext } from "react-router";
import Button from "./UI/button";

const Navbar = () => {
  const { isSignedIn, userName, signOut, signIn } =
    useOutletContext<AuthContext>();

  const handleAuthClick = async () => {
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
                <Button onClick={handleAuthClick} className="btn">
                  Sign Out
                </Button>
              </>
            ) : (
              <>
                <Button onClick={handleAuthClick} size="sm" variant="ghost">Login</Button>
                <a href="#workspace" className="cta">Get Started</a>

              </>
            )}

          </div>
        </nav >
      </header >
  );
};

export default Navbar;
