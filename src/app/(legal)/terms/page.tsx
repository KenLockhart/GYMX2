import type { Metadata } from "next";
import Link from "next/link";
import { PLATFORM_FEE_PERCENT } from "@/lib/armory";
import { LEGAL_UPDATED, MIN_AGE, SUPPORT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <article>
      <h1>Terms of Service</h1>
      <p className="updated">Last updated {LEGAL_UPDATED}</p>

      <p>
        GYMX2 is a platform where coaches and members come together to get fit,
        learn nutrition and get their mind right. These terms are an agreement
        between you and GYMX2 (&ldquo;we&rdquo;, &ldquo;us&rdquo;). By creating
        an account or using gymx2.com, you agree to them. If you don&rsquo;t
        agree, please don&rsquo;t use GYMX2.
      </p>

      <h2>1. Who can use GYMX2</h2>
      <p>
        You must be at least {MIN_AGE} years old and able to enter a binding
        agreement. Give accurate information when you sign up, keep your
        password private, and tell us right away if you think someone else is
        using your account. You are responsible for what happens under your
        account.
      </p>

      <h2>2. Members, coaches, moderators and admins</h2>
      <ul>
        <li>
          <strong>Members</strong> join coaches, watch their videos, complete
          tasks, attend sessions, message coaches and buy from the Armory.
        </li>
        <li>
          <strong>Coaches</strong> are independent. They are not GYMX2
          employees, and GYMX2 does not supervise their training, advice or
          products. An admin approves each coach before they can coach on GYMX2.
        </li>
        <li>
          <strong>Moderators</strong> are people GYMX2 trusts to review reported
          posts and comments in the shared Community feed. They can remove posts
          and comments there, but they can&rsquo;t see direct messages, coach
          communities or anything you keep to yourself.
        </li>
        <li>
          <strong>Admins</strong> run the platform. They approve coaches, keep
          the community safe and may review messages as described in our{" "}
          <Link href="/privacy">Privacy Policy</Link>.
        </li>
      </ul>

      <h2>3. Health and safety</h2>
      <p>
        GYMX2 and its coaches offer general fitness, nutrition and mindset
        information. It is not medical advice and does not replace a doctor,
        registered dietitian or mental-health professional. Talk to your doctor
        before starting a new exercise or nutrition program, especially if you
        are pregnant, injured or have a medical condition. Stop exercising and
        get help if you feel pain, dizziness or shortness of breath.
      </p>
      <p>
        Exercise carries a risk of injury. You choose which programs to follow
        and you take part at your own risk.
      </p>
      <p>
        If you are having a medical or mental-health emergency, call 911 or your
        local emergency number.
      </p>

      <h2>4. How to behave</h2>
      <p>Don&rsquo;t use GYMX2 to:</p>
      <ul>
        <li>harass, threaten, bully or discriminate against anyone;</li>
        <li>
          post anything illegal, sexually explicit, hateful or that you
          don&rsquo;t have the right to share;
        </li>
        <li>
          sell or promote supplements, drugs or products that are unsafe or
          illegal;
        </li>
        <li>
          send spam, scams or malware, or try to break into accounts or the
          site;
        </li>
        <li>copy, resell or share paid content you bought for your own use;</li>
        <li>
          post someone else&rsquo;s photo, video or personal details without
          their permission; or
        </li>
        <li>
          post medical claims, extreme diets or dangerous challenges, or shame
          anyone about their body.
        </li>
      </ul>

      <h3>Community</h3>
      <p>
        In Community you choose who sees each post: everyone signed in to GYMX2,
        the members of one of your coaches&rsquo; communities, or only you.
        Comments and likes are seen by everyone who can see the post. Progress
        posts start as only you, so sharing progress photos is always your
        choice. Photos from your private progress tracker are copied, never
        moved, when you share one.
      </p>
      <p>
        Anyone can report a post or comment. Moderators and admins review
        reports on the shared feed; each coach can remove posts in their own
        community, and admins can review any shared post. We may remove posts or
        comments, limit features or suspend accounts that break these terms. If
        something of yours is removed, we&rsquo;ll tell you, with a reason when
        one is given. Reporting someone in bad faith is itself a breach of these
        terms.
      </p>

      <h3>Finding a coach</h3>
      <p>
        <strong>Profiles.</strong> Coaches must keep their profiles truthful and
        up to date. Don&rsquo;t claim qualifications you don&rsquo;t hold,
        promise particular results (such as a set amount of weight lost in a set
        time), make medical claims or describe yourself with rankings members
        can&rsquo;t check. GYMX2 admins review each profile before it goes live
        and may ask for changes, label claims, or hide or remove a profile.
      </p>
      <p>
        <strong>Verified credentials.</strong> &ldquo;Verified&rdquo; means a
        GYMX2 admin checked the credential with the issuing organization or
        against the document the coach supplied, on the date shown. It
        isn&rsquo;t an endorsement or a guarantee of a coach&rsquo;s skill, and
        an expired credential is never shown as verified. Coaches can&rsquo;t
        mark their own credentials as verified.
      </p>
      <p>
        <strong>Match scores.</strong> Match scores are worked out automatically
        from your quiz answers and the coach&rsquo;s profile, using weights
        GYMX2 sets. They help you compare coaches; they aren&rsquo;t a
        recommendation, a guarantee or a judgment of anyone, and coaches
        can&rsquo;t pay to change them. Where we don&rsquo;t have enough
        information, we say so rather than guess.
      </p>
      <p>
        <strong>Free intro sessions.</strong> Intros are free and don&rsquo;t
        start a membership or any obligation to buy. Either of you can cancel
        before the intro starts. Members can have one free intro per coach and
        up to three upcoming intros at a time. Coaches must only offer times
        they can keep.
      </p>
      <p>
        <strong>Reviews.</strong> Only members who joined a coach can review
        them, once each, about their own experience. Reviews must be honest and
        follow these terms. Coaches must not write or buy reviews, offer
        anything in exchange for a review, or pressure members to change or
        remove one. Coaches can reply publicly but can&rsquo;t edit or remove
        reviews. Anyone can report a review; admins hide reviews that are fake,
        abusive, share private information or break these terms, but don&rsquo;t
        hide a review just because it&rsquo;s negative.
      </p>
      <p>
        <strong>Reporting and blocking.</strong> You can report a coach to GYMX2
        admins at any time. Members can also block a coach they&rsquo;ve left:
        the coach no longer appears in their search, and they can&rsquo;t be
        joined or booked until the member unblocks them. The coach isn&rsquo;t
        told.
      </p>

      <h2>5. Coaches: keep members on GYMX2</h2>
      <p>
        Members find coaches through GYMX2. While you coach here, and for 12
        months after a member last interacted with you on GYMX2, you agree not
        to ask that member to pay you, buy from you or train with you outside
        GYMX2 in a way that avoids the platform, for example by sharing payment
        links, payment app handles or contact details for that purpose. Members
        are free to contact anyone they like; this rule is about coaches moving
        members off the platform. Breaking it can lead to removal of your coach
        account and loss of unpaid earnings where the law allows.
      </p>

      <h2>6. Your content</h2>
      <p>
        You own the videos, files, messages and other content you post. You give
        GYMX2 a worldwide, non-exclusive, royalty-free licence to host, store,
        copy, process and show that content so we can run and improve GYMX2, for
        as long as it is on the platform (and for a short time afterward in
        backups). You confirm you have the rights to everything you post and
        that it doesn&rsquo;t break these terms. We may remove content or
        suspend accounts that break these terms or the law.
      </p>
      <p>
        GYMX2&rsquo;s name, logo and site design belong to us. Don&rsquo;t use
        them without permission.
      </p>

      <h2>7. Buying in the Armory</h2>
      <ul>
        <li>
          Some Armory items link to other shops. Those purchases are between you
          and that shop, under its terms.
        </li>
        <li>
          Items you buy on GYMX2 (digital files and gear) are sold by the coach
          who listed them, or by GYMX2 for its own items. Payments are processed
          by Stripe. GYMX2 never sees or stores your full card number.
        </li>
        <li>
          Prices are in US dollars. Gear ships to US addresses only for now, for
          the shipping fee shown.
        </li>
        <li>
          Digital files are for your personal use. You may download them as
          described on the item, but you may not share or resell them.
        </li>
        <li>
          Refunds and returns are covered by our{" "}
          <Link href="/refunds">Refund and Return Policy</Link>.
        </li>
      </ul>

      <h2>8. Selling in the Armory (coaches)</h2>
      <ul>
        <li>
          To sell, you set up a payout account with Stripe. Payment processing
          services for coaches on GYMX2 are provided by Stripe and are subject
          to the{" "}
          <a href="https://stripe.com/connect-account/legal">
            Stripe Connected Account Agreement
          </a>
          , which includes the{" "}
          <a href="https://stripe.com/legal">Stripe Terms of Service</a>{" "}
          (together, the &ldquo;Stripe Services Agreement&rdquo;). By agreeing
          to these terms or continuing to sell on GYMX2, you agree to be bound
          by the Stripe Services Agreement, as Stripe may change it from time to
          time. As a condition of GYMX2 enabling payments through Stripe, you
          agree to give GYMX2 accurate and complete information about you and
          your business, and you authorize GYMX2 to share it and transaction
          information related to your use of the payment services provided by
          Stripe.
        </li>
        <li>
          GYMX2 keeps a platform fee of {PLATFORM_FEE_PERCENT}% of each
          item&rsquo;s price. Stripe&rsquo;s card processing fees also come out
          of your share. Shipping fees you charge go to you.
        </li>
        <li>
          You are the seller. You are responsible for your listings being
          accurate and lawful, for shipping gear promptly to the address given,
          for handling returns under our Refund and Return Policy, and for any
          taxes on your sales.
        </li>
        <li>
          If a buyer is refunded or disputes a charge with their bank, the
          amount (and any dispute fee) may be taken back from your share.
        </li>
      </ul>

      <h2>9. Affiliate program</h2>
      <p>
        GYMX2 runs an affiliate program for people with a GYMX2 account. These
        terms apply to you if you join it.
      </p>
      <ul>
        <li>
          <strong>Joining.</strong> You apply from your Profile. We may approve
          or decline any application, and we may pause or end your participation
          at any time.
        </li>
        <li>
          <strong>How you earn.</strong> When someone opens your affiliate link
          and creates a new GYMX2 account within the period shown on your
          Affiliate page, they become your referral. You earn the commission
          shown on your Affiliate page on their Armory purchases for the
          referral period shown there, and a one-time bonus when they make their
          first purchase. Rates are those in effect when the purchase is made.
          We may change rates for future purchases at any time; we&rsquo;ll show
          the current rates on your Affiliate page.
        </li>
        <li>
          <strong>What doesn&rsquo;t count.</strong> You don&rsquo;t earn on
          your own purchases, on sales of your own items, on shipping, on people
          who already had an account, or on orders that are refunded or
          disputed. Our records of clicks, sign-ups and purchases decide who
          referred whom.
        </li>
        <li>
          <strong>Holds and payouts.</strong> Commissions become payable after
          the hold period shown on your Affiliate page, so returns and refunds
          can settle first. Once your payable balance reaches the minimum shown
          there, we pay it to the bank account you connect through Stripe.
          Payouts are subject to the{" "}
          <a href="https://stripe.com/connect-account/legal">
            Stripe Connected Account Agreement
          </a>{" "}
          described in section 8. If a purchase is refunded or disputed after
          you were paid, we may deduct that commission from future payouts.
        </li>
        <li>
          <strong>Promoting GYMX2 honestly.</strong> Tell people that you may
          earn from your link, as the law requires (for example, &ldquo;I earn a
          commission if you join&rdquo;). Don&rsquo;t make false or exaggerated
          claims, including health, weight-loss or income promises. Don&rsquo;t
          spam, create fake accounts, sign up or buy through your own link,
          offer people money to sign up, bid on &ldquo;GYMX2&rdquo; in search
          ads, or pretend to be GYMX2. You may use the GYMX2 name only to refer
          people to GYMX2.
        </li>
        <li>
          <strong>Breaking these rules.</strong> If we believe you broke them,
          we may cancel the commissions involved, withhold unpaid commissions,
          and remove you from the program.
        </li>
        <li>
          <strong>Taxes.</strong> You&rsquo;re an independent affiliate, not a
          GYMX2 employee or agent, and you&rsquo;re responsible for taxes on
          what you earn. Stripe may ask for tax details and may issue tax forms
          (such as a 1099 in the US).
        </li>
        <li>
          <strong>Leaving.</strong> You can leave the program at any time by
          emailing us. Commissions you earned before leaving are still paid once
          they pass their hold and your payable balance reaches the minimum.
        </li>
      </ul>

      <h2>10. Ending your account</h2>
      <p>
        You can stop using GYMX2 at any time and ask us to delete your account
        by emailing <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. We
        may suspend or close accounts that break these terms, put others at risk
        or expose us to legal trouble. Sections that by their nature should
        continue (such as content licences needed to process past orders,
        payments owed, disclaimers and limits on liability) survive after an
        account closes.
      </p>

      <h2>11. Disclaimers</h2>
      <p>
        GYMX2 is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. To
        the fullest extent the law allows, we make no promises about results
        from any program, about the accuracy of coach content, or that the site
        will always be available or error-free. We are not responsible for what
        coaches, members or other shops say, sell or do.
      </p>

      <h2>12. Limits on our liability</h2>
      <p>
        To the fullest extent the law allows, GYMX2 is not liable for indirect,
        incidental, special or consequential damages, or for lost profits or
        data. Our total liability for any claim about GYMX2 is limited to the
        greater of the amount you paid through GYMX2 in the 12 months before the
        claim or US$100. Some places don&rsquo;t allow these limits, so they may
        not all apply to you.
      </p>
      <p>
        You agree to cover GYMX2&rsquo;s reasonable costs from claims caused by
        your content, your sales (if you are a coach) or your breaking these
        terms.
      </p>

      <h2>13. Changes and disputes</h2>
      <p>
        We may update these terms. If a change is significant, we will tell you
        by email or on the site before it takes effect. Using GYMX2 after that
        means you accept the new terms. If you have a problem with GYMX2, please
        email us first so we can try to sort it out. These terms are governed by
        the laws of the State of Florida and applicable United States federal
        law, except where your local law gives you rights that can&rsquo;t be
        waived.
      </p>

      <h2>14. Contact</h2>
      <p>
        Questions about these terms:{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
    </article>
  );
}
