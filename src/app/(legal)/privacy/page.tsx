import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL_UPDATED, MIN_AGE, SUPPORT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <article>
      <h1>Privacy Policy</h1>
      <p className="updated">Last updated {LEGAL_UPDATED}</p>

      <p>
        This policy explains what GYMX2 collects when you use gymx2.com, how we
        use it, who we share it with and the choices you have. We don&rsquo;t
        sell your personal information, and we don&rsquo;t show ads.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account details:</strong> your name, email address, password
          (stored only as a secure hash) and whether you are a member, coach or
          admin.
        </li>
        <li>
          <strong>Profile:</strong> your bio and any social media or website
          links you add. Coach profiles are visible to signed-in members.
        </li>
        <li>
          <strong>What you do on GYMX2:</strong> coaches you join, tasks and
          their progress, memos, calendar sessions and your responses, and
          messages between coaches and members.
        </li>
        <li>
          <strong>Tracking:</strong> the habits you check off, body measurements
          (such as weight, body fat and waist), progress photos and nutrition
          notes you choose to log, and your progress on coaches&rsquo; programs.
          Only you can see them unless you turn on sharing with your coaches.
          GYMX2 admins can&rsquo;t see them, and we use them only to show you
          your progress.
        </li>
        <li>
          <strong>What you upload:</strong> videos, files and images, such as
          training videos and Armory items.
        </li>
        <li>
          <strong>Purchases:</strong> what you bought, the price, and for gear
          your size, name and shipping address. Card details go straight to
          Stripe; GYMX2 never sees or stores your full card number.
        </li>
        <li>
          <strong>Coach payouts:</strong> to pay coaches, Stripe collects
          identity, tax and bank details. We only receive whether the account is
          ready to take payments and receive payouts.
        </li>
        <li>
          <strong>Affiliate links:</strong> when you open an affiliate&rsquo;s
          link we count the click and set a cookie that remembers who sent you,
          so they can be credited if you sign up.
        </li>
        <li>
          <strong>Technical information:</strong> like most websites, our
          hosting providers record IP addresses, browser type and pages
          requested in server logs, used for security and fixing problems.
        </li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>
          to run GYMX2: sign you in, connect members with coaches, deliver
          videos, files and messages;
        </li>
        <li>
          to process Armory orders, pay coaches and let sellers ship gear;
        </li>
        <li>
          to send emails you need, such as account confirmations, password
          resets, order and shipping updates, and (unless you turn them off)
          new-message and session emails;
        </li>
        <li>
          to keep the community safe, enforce our{" "}
          <Link href="/terms">Terms</Link> and prevent fraud;
        </li>
        <li>to fix bugs and improve GYMX2; and</li>
        <li>to meet legal obligations, such as tax and accounting records.</li>
      </ul>

      <h2>Admins may review messages</h2>
      <p>
        Messages on GYMX2 are private between a coach and a member, but they are
        not end-to-end encrypted. GYMX2 admins can read coach–member
        conversations to keep members safe, investigate reports, and stop
        coaches from moving members off the platform in breach of our Terms.
        GYMX2 automatically checks messages for things like phone numbers, email
        addresses and payment apps, and points admins to those conversations.
        Admins can read but cannot send, change or delete messages in your
        conversations. Please don&rsquo;t share passwords, card numbers or other
        sensitive information in messages.
      </p>

      <h2>Who sees your information</h2>
      <ul>
        <li>
          <strong>Coaches you join</strong> see your name, your progress on
          their tasks and programs, your session responses and your messages
          with them.
        </li>
        <li>
          <strong>Coach groups:</strong> each coach has a group chat with all of
          their members. Everyone in the group sees your name and what you post
          there. The coach can remove posts, and GYMX2 admins can read groups
          for the same safety reasons as messages.
        </li>
        <li>
          <strong>Live sessions:</strong> when a coach streams a session live,
          only the coach is on camera and nothing is recorded. Members invited
          to the session see your name and live chat messages, and your coach
          sees that you watched.
        </li>
        <li>
          <strong>Sellers</strong> see what you bought from them and, for gear,
          your name, size and shipping address so they can send it to you.
        </li>
        <li>
          <strong>Affiliates:</strong> if you joined through someone&rsquo;s
          affiliate link, they see that someone signed up and the commissions
          they earned from purchases, but not your name, email or what you
          bought beyond the item and amount. If you&rsquo;re an affiliate, we
          share your payout details with Stripe to pay you.
        </li>
        <li>
          <strong>Service providers</strong> that run parts of GYMX2 for us and
          may only use your information to do so: Supabase (database, sign-in
          and file storage), Vercel (website hosting), Cloudflare (video hosting
          and website security), Stripe (payments and coach payouts) and Resend
          (email delivery).
        </li>
        <li>
          <strong>Legal reasons:</strong> when required by law, or to protect
          the safety, rights or property of our members, coaches or GYMX2.
        </li>
        <li>
          <strong>Business changes:</strong> if GYMX2 is sold or merged, your
          information may move to the new owner under this policy.
        </li>
      </ul>

      <h2>Phone notifications</h2>
      <p>
        If you turn on notifications for a device, your browser gives us an
        address to send them to. We use it only to send GYMX2 notifications
        (such as new messages, group posts, live sessions and program days),
        through your browser maker&rsquo;s push service (for example Apple,
        Google or Mozilla). The notification text passes through that service
        encrypted. Turn notifications off on your Profile page or in your device
        settings at any time.
      </p>

      <h2>Cookies</h2>
      <p>
        We use only the cookies needed to keep you signed in, keep the site
        secure and, if you arrived through an affiliate link, remember who
        referred you. We don&rsquo;t use advertising or tracking cookies. Stripe
        may set its own cookies on its checkout pages to prevent fraud.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep your information while your account is open. When you delete
        your account, we delete or anonymize your profile, uploads and messages
        within 30 days, except where we must keep records longer, such as
        purchase records for tax and accounting, or information needed to
        resolve disputes or enforce our Terms. Backups are overwritten on a
        rolling basis.
      </p>

      <h2>Your choices and rights</h2>
      <ul>
        <li>
          You can update your name, bio and links on your Profile page at any
          time.
        </li>
        <li>
          You can turn off message and session emails on your Profile page.
          Order emails always send.
        </li>
        <li>
          You can ask for a copy of your information, ask us to correct or
          delete it, or ask us to close your account by emailing{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. Depending on
          where you live, you may have further rights under local law, and we
          will honor them.
        </li>
      </ul>

      <h2>Security</h2>
      <p>
        We protect your information with encrypted connections, access rules in
        our database that limit each person to what they are allowed to see, and
        providers with strong security practices. No system is perfectly secure,
        so use a strong password you don&rsquo;t use anywhere else.
      </p>

      <h2>Age</h2>
      <p>
        GYMX2 is for people {MIN_AGE} and older. We don&rsquo;t knowingly
        collect information from anyone younger. If you think someone under{" "}
        {MIN_AGE} has an account, tell us and we will remove it.
      </p>

      <h2>Where your information is stored</h2>
      <p>
        GYMX2 is run from the United States, and your information is stored and
        processed in the United States.
      </p>

      <h2>Changes</h2>
      <p>
        If we change this policy in a significant way, we will tell you by email
        or on the site before the change takes effect.
      </p>

      <h2>Contact</h2>
      <p>
        Privacy questions or requests:{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
    </article>
  );
}
