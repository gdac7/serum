import { useState } from "react";
import { NavLink } from "react-router-dom";
import { IconUser } from "./icons";
import { AccountModal } from "./AccountModal";

export function Nav() {
  const [profileOpen, setProfileOpen] = useState(false);

  return (
    <nav className="nav">
      <span className="nav-brand">Serum</span>
      <NavLink to="/chat">Chat</NavLink>
      <NavLink to="/security-testing">Security Testing</NavLink>
      <NavLink to="/results">Results</NavLink>
      <button
        type="button"
        className="btn btn-ghost btn-icon"
        aria-label="Account"
        onClick={() => setProfileOpen(true)}
      >
        <IconUser />
      </button>
      {profileOpen && <AccountModal onClose={() => setProfileOpen(false)} />}
    </nav>
  );
}
