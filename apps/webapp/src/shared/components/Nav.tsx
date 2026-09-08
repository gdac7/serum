import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { APPROACHES } from "../../approaches/registry";
import { IconUser } from "./icons";
import { AccountModal } from "./AccountModal";

export function Nav() {
  const [profileOpen, setProfileOpen] = useState(false);
  const { pathname } = useLocation();

  // An approach's own pages live at /<id>/…, so these two tabs stay lit while
  // you are inside one instead of going dark the moment the picker hands off.
  const inApproach = (suffix: string) =>
    APPROACHES.some((a) => pathname.startsWith(`/${a.id}/${suffix}`));

  return (
    <nav className="nav">
      <span className="nav-brand">Serum</span>
      <NavLink to="/chat">Chat</NavLink>
      <NavLink
        to="/security-testing"
        className={inApproach("security-testing") ? "is-active" : undefined}
      >
        Security Testing
      </NavLink>
      <NavLink to="/targets">Targets</NavLink>
      <NavLink to="/results" className={inApproach("results") ? "is-active" : undefined}>
        Results
      </NavLink>
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
