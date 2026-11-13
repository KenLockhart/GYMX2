import Image from "next/image";
import Link from "next/link";
import { BrandLink } from "@/components/brand-link";
import { SUPPORT_EMAIL } from "@/lib/legal";
import { HomepageHeader } from "./homepage-header";
import {
  benefits,
  disciplines,
  illustrativeRoles,
  learningExamples,
} from "./content";

function RoleMark() {
  return (
    <span className="homepage-role-mark" aria-hidden="true">
      <span className="homepage-role-mark-head" />
      <span className="homepage-role-mark-body" />
    </span>
  );
}

export function HomepagePage() {
  return (
    <div className="homepage">
      <HomepageHeader />

      <main>
        <section className="homepage-hero homepage-section" aria-labelledby="homepage-title">
          <div className="homepage-hero-copy">
            <p className="homepage-eyebrow">COACHES. CREATORS. EVERY WAY TO MOVE.</p>
            <h1 id="homepage-title" className="homepage-title">
              <span>Your passion.</span>
              <span>Your craft.</span>
              <span className="homepage-accent">Your influence.</span>
            </h1>
            <p className="homepage-tagline">Find your people. Develop your potential.</p>
            <p className="homepage-intro">
              Connect through sport, dance, movement and physical performance.
            </p>
            <div className="homepage-hero-actions">
              <Link href="#explore" className="homepage-button homepage-button-primary">
                Explore GymX2
              </Link>
              <Link
                href="/signup?next=%2Fprofile"
                className="homepage-button homepage-button-secondary"
              >
                I am a Coach
              </Link>
            </div>
            <p className="homepage-hero-note">
              Coaches begin with the same account, can request coach access during sign-up, and need administrator approval before coach tools unlock.
            </p>
          </div>

          <figure className="homepage-hero-visual">
            <div className="homepage-hero-image">
              <Image
                src="/homepage/hero-collage.webp"
                alt="Illustrative collage of gym training, baseball pitching instruction and basketball footwork coaching; these are promotional scenes, not member profiles"
                fill
                preload
                sizes="(max-width: 760px) 100vw, (max-width: 1200px) 52vw, 650px"
              />
            </div>
            <figcaption>Illustrative promotional imagery · not member profiles</figcaption>
          </figure>
        </section>

        <div className="homepage-divider" aria-hidden="true">
          <span />
          <p>SPORT <i>·</i> DANCE <i>·</i> STRENGTH <i>·</i> SKILL <i>·</i> MOVEMENT</p>
          <span />
        </div>

        <section className="homepage-section homepage-disciplines" id="explore" aria-labelledby="disciplines">
          <div className="homepage-section-heading">
            <p className="homepage-eyebrow">EXPLORE YOUR DISCIPLINE</p>
            <h2 id="disciplines">One platform. Countless ways to move.</h2>
            <p>Whatever your discipline, there is a place for your passion.</p>
          </div>

          <div className="homepage-discipline-grid">
            {disciplines.map((discipline) => (
              <details className="homepage-discipline-card" key={discipline.title}>
                <summary>
                  <span className="homepage-discipline-image">
                    <Image
                      src={discipline.image}
                      alt={discipline.alt}
                      fill
                      loading="lazy"
                      sizes="(max-width: 640px) 48vw, (max-width: 1020px) 31vw, 19vw"
                      style={{ objectPosition: discipline.position }}
                    />
                    <span className="homepage-discipline-shade" />
                    <span className="homepage-discipline-name">{discipline.title}</span>
                    <span className="homepage-discipline-expand" aria-hidden="true">+</span>
                  </span>
                  <span className="homepage-sr-only">Show more about {discipline.title}</span>
                </summary>
                <p>{discipline.description}</p>
              </details>
            ))}
          </div>
          <p className="homepage-image-note">Illustrative promotional imagery · not member profiles</p>
        </section>

        <section className="homepage-section homepage-people" aria-labelledby="people-title">
          <div className="homepage-section-heading homepage-heading-inline">
            <div>
              <p className="homepage-eyebrow">A SHARED PASSION, MANY POINTS OF VIEW</p>
              <h2 id="people-title">Meet the people behind the passion.</h2>
            </div>
            <p>Coaches and creators, connected by a passion for helping others grow.</p>
          </div>

          <div className="homepage-role-grid" aria-label="Illustrative coaching roles">
            {illustrativeRoles.map((role) => (
              <article className="homepage-role-card" key={role.title}>
                <RoleMark />
                <div>
                  <span className="homepage-role-label">Illustrative role · {role.category}</span>
                  <h3>{role.title}</h3>
                  <p>{role.description}</p>
                </div>
              </article>
            ))}
          </div>
          <p className="homepage-image-note">
            Role examples only · no member profiles or endorsements shown
          </p>
          <div className="homepage-centered-action">
            <Link
              href="/signup?next=%2Fcoaches"
              className="homepage-text-link"
            >
              Join to explore coaches <span aria-hidden="true">→</span>
            </Link>
          </div>
        </section>

        <section className="homepage-section homepage-learning" aria-labelledby="learning-title">
          <div className="homepage-section-heading homepage-heading-inline">
            <div>
              <p className="homepage-eyebrow">IDEAS TO KEEP YOU MOVING</p>
              <h2 id="learning-title">Watch. Learn. Get Inspired.</h2>
            </div>
            <p>Explore lessons and skills from coaches across different disciplines.</p>
          </div>
          <div className="homepage-learning-grid">
            {learningExamples.map((example) => (
              <article className="homepage-learning-card" key={example.title}>
                <div className="homepage-learning-image">
                  <Image
                    src={example.image}
                    alt={example.alt}
                    fill
                    loading="lazy"
                    sizes="(max-width: 700px) 100vw, (max-width: 1000px) 50vw, 33vw"
                  />
                  <span className="homepage-learning-tag">Illustrative scene</span>
                </div>
                <div className="homepage-learning-copy">
                  <p className="homepage-eyebrow">{example.category}</p>
                  <h3>{example.title}</h3>
                </div>
              </article>
            ))}
          </div>
          <p className="homepage-access-note">
            These are promotional examples, not videos. Available content and access depend on the coach and membership.
          </p>
          <div className="homepage-centered-action">
            <Link
              href="/signup?next=%2Flibrary"
              className="homepage-button homepage-button-secondary"
            >
              Explore GymX2
            </Link>
          </div>
        </section>

        <section className="homepage-section homepage-pathways" aria-labelledby="pathways-title">
          <div className="homepage-section-heading">
            <p className="homepage-eyebrow">YOUR JOURNEY STARTS HERE</p>
            <h2 id="pathways-title">Your journey starts here.</h2>
            <p>Start with what you want to do today. Your path can change as your practice does.</p>
          </div>
          <div className="homepage-pathway-grid">
            <article className="homepage-pathway-card">
              <p className="homepage-eyebrow">I’M HERE TO LEARN</p>
              <h3>Find a coach who gets your goals.</h3>
              <p>
                Explore coaches and disciplines, then build your practice with lessons, programs and connection.
              </p>
              <Link
                href="/signup?next=%2Fcoaches"
                className="homepage-button homepage-button-primary"
              >
                Join to explore coaches
              </Link>
            </article>
            <article className="homepage-pathway-card homepage-pathway-coach" id="coach-path">
              <p className="homepage-eyebrow">I’M HERE TO INSPIRE</p>
              <h3>Bring your craft to the community.</h3>
              <p>
                Create an account and request coach access during sign-up. An administrator must approve coach access before coach tools unlock.
              </p>
              <Link
                href="/signup?next=%2Fprofile"
                className="homepage-button homepage-button-secondary"
              >
                I am a Coach
              </Link>
            </article>
          </div>
        </section>

        <section className="homepage-section homepage-community" id="community" aria-labelledby="community-title">
          <div className="homepage-community-copy">
            <p className="homepage-eyebrow">MORE THAN THE NEXT REP</p>
            <h2 id="community-title">More than a platform. A community.</h2>
            <p>
              Bring questions, share what you are learning and stay connected to people who support your practice.
            </p>
            <Link
              href="/signup?next=%2Fcommunity"
              className="homepage-button homepage-button-primary"
            >
              Join the community
            </Link>
          </div>
          <div className="homepage-community-aside" aria-hidden="true">
            <span className="homepage-community-line" />
            <p>SHOW UP<br />KEEP LEARNING<br /><strong>MOVE FORWARD</strong></p>
            <span className="homepage-community-line" />
          </div>
        </section>

        <section className="homepage-section homepage-benefits" aria-labelledby="benefits-title">
          <div className="homepage-section-heading homepage-heading-inline">
            <div>
              <p className="homepage-eyebrow">BUILT AROUND YOUR PRACTICE</p>
              <h2 id="benefits-title">Your passion deserves a place to grow.</h2>
            </div>
            <p>Training is personal. Your tools should help you stay focused on what matters.</p>
          </div>
          <div className="homepage-benefit-grid">
            {benefits.map((benefit) => (
              <article className="homepage-benefit-card" key={benefit.number}>
                <p className="homepage-benefit-number">{benefit.number}</p>
                <h3>{benefit.title}</h3>
                <p>{benefit.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="homepage-section homepage-closing" id="about" aria-labelledby="closing-title">
          <p className="homepage-eyebrow">YOUR PASSION HAS A PLACE HERE</p>
          <h2 id="closing-title">Your next chapter starts with GymX2.</h2>
          <p>
            GymX2 connects coaches, instructors and learners across sport, dance, movement and physical performance.
          </p>
          <div className="homepage-hero-actions homepage-closing-actions">
            <Link href="/signup" className="homepage-button homepage-button-primary">
              Join GymX2
            </Link>
            <Link href="#explore" className="homepage-button homepage-button-secondary">
              Explore GymX2
            </Link>
          </div>
        </section>

        <section className="homepage-contact" aria-label="GymX2 contact">
          <BrandLink />
          <nav className="homepage-contact-nav" aria-label="Homepage secondary navigation">
            <Link href="#explore">Explore</Link>
            <Link href="#about">About</Link>
            <Link href="#coach-path">Coaches</Link>
            <Link href="#community">Community</Link>
            <Link href="/signup">Join</Link>
          </nav>
          <p>Questions? <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></p>
          <Link href="/login" className="homepage-contact-login">Log in</Link>
        </section>
      </main>
    </div>
  );
}
