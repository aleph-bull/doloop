import { ArrowRight, CalendarDays, Check, Play, Timer } from 'lucide-react';
import { Link } from 'react-router';
import { LogoMark } from '@komogon/ui';
import { useAuth } from '../lib/auth';

export function Landing() {
  const auth = useAuth();
  const signedIn = auth.status === 'signed-in';
  return (
    <div className="landing">
      <div className="landing-content">
        <header className="landing-nav">
          <Link to="/" className="brand" aria-label="Komodon home">
            <span className="landing-brand-mark">
              <LogoMark size={24} />
            </span>
            <span>Komodon</span>
          </Link>
          <nav aria-label="Main navigation">
            <a href="#how-it-works">How it works</a>
            <a href="#social">Social</a>
            <Link to={signedIn ? '/' : '/signin'}>{signedIn ? 'Open dashboard' : 'Sign in'}</Link>
          </nav>
        </header>
        <main>
          <section className="landing-hero" aria-labelledby="landing-title">
            <div className="landing-intro">
              <p className="landing-kicker">Komodon · Study planner</p>
              <h1 id="landing-title">Keep your coursework and study time together.</h1>
              <p className="landing-lead">
                Bring in your deadlines, start a session and keep track of the work you finish. Your
                courses, calendar and study time stay together.
              </p>
              <div className="landing-actions">
                <Link className="btn btn-primary btn-lg" to={signedIn ? '/' : '/signup'}>
                  {signedIn ? 'Open dashboard' : 'Create an account'}
                  <ArrowRight size={18} aria-hidden />
                </Link>
                <a className="landing-text-link" href="#how-it-works">
                  See how it works
                </a>
              </div>
              <p className="landing-footnote">
                You can start a session without setting up a course or task.
              </p>
            </div>
            <div className="landing-preview" aria-label="Example of a course and study session">
              <div className="landing-preview-top">
                <span>Example dashboard</span>
                <CalendarDays size={18} aria-hidden />
              </div>
              <div className="landing-preview-tabs">
                <span>Dashboard</span>
                <span>Tasks</span>
                <span>Calendar</span>
                <span>Social</span>
              </div>
              <div className="landing-preview-body">
                <div className="landing-preview-work">
                  <div className="landing-example-course">
                    <span className="landing-course-dot" />
                    <span>CSC108</span>
                    <span className="landing-example-label">Course</span>
                  </div>
                  <div className="landing-example-task">
                    <span className="landing-check">
                      <Check size={15} aria-hidden />
                    </span>
                    <div>
                      <strong>Problem set 3</strong>
                      <span>Due Friday</span>
                    </div>
                  </div>
                  <div className="landing-example-task">
                    <span className="landing-empty-check" />
                    <div>
                      <strong>Midterm revision</strong>
                      <span>Planned for Thursday</span>
                    </div>
                  </div>
                </div>
                <div className="landing-example-session">
                  <div>
                    <Timer size={18} aria-hidden />
                    <span>Pomodoro</span>
                  </div>
                  <span className="landing-example-clock">
                    25<span>min</span>
                  </span>
                  <Link to={signedIn ? '/' : '/signup'} className="landing-preview-start">
                    <Play size={15} aria-hidden /> Start
                  </Link>
                </div>
              </div>
            </div>
          </section>
          <section className="landing-social" id="social">
            <div>
              <p className="landing-kicker">Social</p>
              <h2>People at your school or organization.</h2>
              <p>
                Verify your school or work email, then choose whether to share your profile with
                people from the same email domain. Your sign-in email can stay the same.
              </p>
              <Link to={signedIn ? '/social' : '/signup'} className="landing-text-link">
                Set up your profile <ArrowRight size={16} aria-hidden />
              </Link>
            </div>
            <div className="landing-profile-example">
              <span className="landing-profile-initial">A</span>
              <div>
                <span className="landing-example-label">Example profile</span>
                <strong>Alex</strong>
                <span>University of Toronto</span>
                <span className="landing-profile-badge">
                  <Check size={14} aria-hidden /> utoronto.ca email verified
                </span>
              </div>
            </div>
          </section>
          <section
            id="how-it-works"
            className="landing-details"
            aria-labelledby="landing-details-title"
          >
            <div className="landing-section-head">
              <h2 id="landing-details-title">What you can do.</h2>
            </div>
            <div className="landing-feature-list">
              <article>
                <span className="landing-step">01</span>
                <h3>Keep track of what’s due.</h3>
                <p>
                  Add courses and assignments yourself, or import courses, exams and deadlines from
                  Google or Outlook Calendar.
                </p>
                <Link to="/signup">
                  Set up your courses <ArrowRight size={15} aria-hidden />
                </Link>
              </article>
              <article>
                <span className="landing-step">02</span>
                <h3>Choose how you study.</h3>
                <p>
                  Work straight through or use Pomodoro breaks. Show or hide the clock. Record a
                  timelapse if you want one.
                </p>
                <Link to="/signup">
                  Start a session <ArrowRight size={15} aria-hidden />
                </Link>
              </article>
              <article>
                <span className="landing-step">03</span>
                <h3>See what you’ve done.</h3>
                <p>
                  Review your study time, keep a routine and check your progress by course. Rest
                  days fit into the plan.
                </p>
                <Link to="/signup">
                  Track your work <ArrowRight size={15} aria-hidden />
                </Link>
              </article>
            </div>
          </section>
          <section className="landing-end">
            <div>
              <h2>Ready to study?</h2>
              <p>Create an account and start a session.</p>
            </div>
            <Link className="btn btn-primary btn-lg" to={signedIn ? '/' : '/signup'}>
              {signedIn ? 'Open dashboard' : 'Create an account'}
              <ArrowRight size={18} aria-hidden />
            </Link>
          </section>
        </main>
        <footer className="landing-footer">
          <span>Komodon</span>
          <Link to="/signin">Sign in</Link>
        </footer>
      </div>
    </div>
  );
}
