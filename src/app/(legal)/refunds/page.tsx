import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL_UPDATED, RETURN_WINDOW_DAYS, SUPPORT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = { title: "Refund and Return Policy" };

export default function RefundsPage() {
  return (
    <article>
      <h1>Refund and Return Policy</h1>
      <p className="updated">Last updated {LEGAL_UPDATED}</p>

      <p>
        Items in the Armory are sold by the coach who listed them, or by GYMX2
        for its own items. This policy applies to everything bought on
        gymx2.com. Items that link to another shop follow that shop&rsquo;s
        policy.
      </p>

      <h2>Digital files (ebooks, programs and other downloads)</h2>
      <p>
        Because a download can&rsquo;t be returned, digital purchases are final
        once you have bought them. We will refund a digital purchase if:
      </p>
      <ul>
        <li>
          the file won&rsquo;t download or open and the seller can&rsquo;t fix
          it within 7 days;
        </li>
        <li>the file is clearly not what the listing described; or</li>
        <li>you were charged more than once for the same item by mistake.</li>
      </ul>
      <p>Ask within 14 days of buying.</p>

      <h2>Gear (shirts and other physical items)</h2>
      <ul>
        <li>
          <strong>Shipping:</strong> sellers ship to US addresses only for now.
          Most orders ship within 5 business days, and you get an email with
          tracking when yours ships. If your order hasn&rsquo;t shipped within
          14 days, you can cancel it for a full refund.
        </li>
        <li>
          <strong>Damaged, defective or wrong items:</strong> tell the seller
          within {RETURN_WINDOW_DAYS} days of delivery, with a photo if you can.
          You will get a replacement or a full refund, including shipping, and
          you won&rsquo;t pay to send it back.
        </li>
        <li>
          <strong>Changed your mind or wrong size:</strong> unworn, unwashed
          items with tags can be returned within {RETURN_WINDOW_DAYS} days of
          delivery. Ask the seller first; they will tell you where to send it.
          You pay the return shipping, and once the seller receives the item you
          are refunded the item price (the original shipping fee isn&rsquo;t
          refunded). Some sellers may offer an exchange instead.
        </li>
        <li>
          <strong>Lost packages:</strong> if tracking shows no delivery after 14
          days from shipping, contact the seller and they will resend the item
          or refund you.
        </li>
      </ul>

      <h2>How to ask for a refund or return</h2>
      <ol className="mb-4 list-decimal space-y-1.5 pl-6">
        <li>
          Message the seller on GYMX2 with what you bought and what went wrong.
        </li>
        <li>
          If you don&rsquo;t hear back within 3 business days, or you
          can&rsquo;t agree, email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and GYMX2 will
          step in and make the final call.
        </li>
      </ol>
      <p>
        Approved refunds go back to the card you paid with. Your bank may take
        5–10 business days to show it.
      </p>

      <h2>Card disputes</h2>
      <p>
        Please contact us before disputing a charge with your bank; we can
        usually fix things faster. For coaches: refunds and lost disputes come
        out of the seller&rsquo;s share, as explained in our{" "}
        <Link href="/terms">Terms</Link>.
      </p>

      <h2>Your legal rights</h2>
      <p>
        This policy doesn&rsquo;t limit any rights you have under consumer
        protection laws where you live.
      </p>
    </article>
  );
}
