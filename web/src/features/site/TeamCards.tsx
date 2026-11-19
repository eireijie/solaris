import { publicUrl } from "../../lib/paths";
import type { TeamMember } from "./team";
import { TEAM } from "./team";
import "./site.css";

export function Avatar({ member, size = 56 }: { member: TeamMember; size?: number }) {
  if (member.photo) {
    const src = /^https?:/.test(member.photo) ? member.photo : publicUrl(member.photo);
    return <img className="site-avatar site-avatar--photo" src={src} alt="" width={size} height={size} style={{ width: size, height: size }} />;
  }
  return (
    <span className={`site-avatar site-avatar--${member.kind}`} style={{ width: size, height: size, fontSize: size * 0.36 }} aria-hidden="true">
      <svg className="site-avatar__ring" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="48" />
      </svg>
      <span>{member.initials}</span>
    </span>
  );
}

export function TeamCard({ member, compact }: { member: TeamMember; compact?: boolean }) {
  return (
    <article className={`site-team-card ${compact ? "site-team-card--compact" : ""}`}>
      <Avatar member={member} size={compact ? 44 : 64} />
      <div className="site-team-card__body">
        <h3 className="site-team-card__name">{member.name}</h3>
        <p className="site-team-card__role">{member.role}</p>
        {!compact ? <p className="site-team-card__focus">{member.bio ?? member.focus}</p> : null}
        <p className="site-team-card__aff">{member.affiliation}</p>
        {member.email || member.links?.length ? (
          <p className="site-team-card__links">
            {member.email ? <a href={`mailto:${member.email}`}>Email</a> : null}
            {member.links?.map((l) => (
              <a key={l.href} href={l.href} target="_blank" rel="noreferrer">
                {l.label}
              </a>
            ))}
          </p>
        ) : null}
      </div>
    </article>
  );
}

export function TeamGrid({ compact }: { compact?: boolean }) {
  return (
    <div className={`site-team-grid ${compact ? "site-team-grid--compact" : ""}`}>
      {TEAM.map((m) => (
        <TeamCard key={m.name} member={m} compact={compact} />
      ))}
    </div>
  );
}
