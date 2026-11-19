import { Button, Modal } from "../../components/ui";
import { TeamGrid } from "./TeamCards";
import { PRESENTED_AT } from "./team";
import "./site.css";

const STEPS = [
  {
    title: "Pick a station, run Aeros",
    text: "Choose one of 45 stations or upload a CSV. Aeros projects its winters and summers to 2100.",
  },
  {
    title: "Check it against the past",
    text: "Nexus re-runs Aeros as if it were 2000 and scores it on 2001–2026.",
  },
  {
    title: "Test what changes it",
    text: "Follow global CO₂ with CORe, then edit emissions pathways in Catalyst.",
  },
];

export function WelcomeDialog({
  open,
  onClose,
  onCreateAccount,
  onGuide,
  accountsAvailable,
}: {
  open: boolean;
  onClose: () => void;
  onCreateAccount: () => void;
  onGuide: () => void;
  accountsAvailable: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={
        <>
          Welcome to Solaris
        </>
      }
      description="A climate research platform built by two students and their mentor. The models run in your browser."
      footer={
        <div className="site-welcome__actions">
          <button type="button" className="site-welcome__guide" onClick={onGuide}>
            How to use Solaris
          </button>
          <div className="site-welcome__buttons">
            {accountsAvailable ? (
              <Button variant="secondary" onClick={onCreateAccount}>
                Create an account
              </Button>
            ) : null}
            <Button onClick={onClose} data-testid="welcome-explore">
              Continue without an account
            </Button>
          </div>
        </div>
      }
    >
      <div className="site-welcome" data-testid="welcome-dialog">
        <section aria-labelledby="welcome-team">
          <h3 id="welcome-team" className="site-welcome__h">
            Who we are
          </h3>
          <TeamGrid compact />
          <p className="site-welcome__presented">{PRESENTED_AT}.</p>
        </section>
        <section aria-labelledby="welcome-steps">
          <h3 id="welcome-steps" className="site-welcome__h">
            What you can do here
          </h3>
          <ol className="site-welcome__steps">
            {STEPS.map((s, i) => (
              <li key={s.title} className="site-welcome__step">
                <span className="site-welcome__num" aria-hidden="true">
                  {i + 1}
                </span>
                <div>
                  <p className="site-welcome__step-title">{s.title}</p>
                  <p className="site-welcome__step-text">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
        <p className="site-welcome__privacy">Data you upload stays in this browser unless you save a run to your account.</p>
      </div>
    </Modal>
  );
}
