import type { Metadata } from "next";
import { LegalPage } from "@/components/legal";

type Props = { searchParams: Promise<{ lang?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return (await searchParams).lang === "vi"
    ? { title: "Giới thiệu · InvestHepi", description: "InvestHepi là gì, tin tức và giá lấy từ đâu, và AI được giữ trung thực thế nào." }
    : { title: "About · InvestHepi", description: "What InvestHepi is, where its news and prices come from, and how its AI is kept honest." };
}

/** The public About page: English, or Vietnamese with `?lang=vi` (the footer link passes it for Vietnamese readers). */
export default async function About({ searchParams }: Props) {
  const vi = (await searchParams).lang === "vi";
  const other = vi ? <a href="/about">English</a> : <a href="/about?lang=vi">Tiếng Việt</a>;
  return vi ? (
    <LegalPage title="Giới thiệu InvestHepi" lang="vi">
      <p>{other}</p>
      <p>
        InvestHepi giúp bạn nắm nhanh những tin quan trọng và thú vị, hiểu rõ chúng, thấy tác động lên thị trường và thế giới, và học thêm kiến
        thức chung trên đường đi. Bạn không cần kiến thức tài chính.
      </p>
      <h2>Cách hoạt động</h2>
      <ul>
        <li>
          <b>Câu chuyện, không phải danh sách tin.</b> Các bài về cùng một sự kiện từ nhiều báo được gom thành một câu chuyện. AI viết một thẻ
          cho mỗi câu chuyện: chuyện gì xảy ra, vì sao quan trọng, tác động lên thị trường và thế giới, sự kiện tương tự trong quá khứ và các
          thuật ngữ cần biết.
        </li>
        <li>
          <b>Mỗi lượt cập nhật:</b> 5 câu chuyện quan trọng nhất và 2 câu chuyện thú vị (khoa học, sức khỏe, văn hóa) cho mỗi mục. Một câu
          chuyện lớn được nhiều báo đưa cùng lúc có thẻ trong vòng khoảng 30 phút.
        </li>
        <li>
          <b>Mục Việt Nam</b> được viết bằng tiếng Việt. Mục Thế giới và Mỹ được viết bằng tiếng Anh và dịch sẵn sang tiếng Việt.
        </li>
        <li>
          <b>Dự đoán</b> là phần phụ: hai lần mỗi ngày giao dịch cho từng thị trường, theo giờ địa phương, và được chấm đúng sai sau mỗi phiên.
          Kết quả được công khai trong mục Thành tích.
        </li>
      </ul>
      <h2>AI được giữ trung thực thế nào</h2>
      <ul>
        <li>Mọi con số về giá trên trang lấy từ dữ liệu giá thật, không do AI viết. Câu nào có con số không có trong dữ liệu đầu vào thì bị bỏ.</li>
        <li>Một thẻ chỉ được trích các bài thuộc chính câu chuyện đó, và mọi nguồn đều có đường dẫn.</li>
        <li>Sự kiện quá khứ lấy từ một thư viện 80 mục đã kiểm chứng (ngày, biến động đo được, nguồn), không lấy từ trí nhớ của AI.</li>
        <li>Thiếu dữ liệu mới thì không đoán: lượt dự đoán được ghi là &quot;không có dữ liệu&quot;.</li>
      </ul>
      <h2>Nguồn tin và giá</h2>
      <p>
        Tin từ các nguồn RSS công khai (VnExpress, CafeF, Vietstock, Tuổi Trẻ, BBC, NPR, CNBC, Al Jazeera, Google News và các báo khác). Giá từ
        các nguồn công khai, miễn phí và không chính thức, nên có thể chậm hoặc sai. AI chạy trên gói miễn phí của Google Gemini và Groq.
      </p>
      <h2>Không phải lời khuyên đầu tư</h2>
      <p>
        Dự đoán do AI tạo tự động và thường xuyên sai. Hãy xem lịch sử dự đoán và tự nghiên cứu trước khi quyết định. Xem thêm{" "}
        <a href="/terms">Điều khoản</a> và <a href="/privacy">Quyền riêng tư</a>.
      </p>
      <h2>Mã nguồn</h2>
      <p>InvestHepi là phần mềm mã nguồn mở theo giấy phép MIT.</p>
    </LegalPage>
  ) : (
    <LegalPage title="About InvestHepi">
      <p>{other}</p>
      <p>
        InvestHepi helps you catch up on the important and interesting news, understand it, see its effect on markets and the world, and learn
        some general knowledge along the way. You don&apos;t need a finance background.
      </p>
      <h2>How it works</h2>
      <ul>
        <li>
          <b>Stories, not a list of links.</b> Reports of the same event from several outlets are grouped into one story. The AI writes one card
          per story: what happened, why it matters, the effect on markets and the world, a similar past event, and the terms worth knowing.
        </li>
        <li>
          <b>Each update</b> brings the 5 most important stories and 2 interesting ones (science, health, culture) per section. A big story that
          many outlets report at once gets a card within about 30 minutes.
        </li>
        <li>
          <b>The Vietnam section</b> is written in Vietnamese. World and US are written in English and translated for readers of the other 7
          languages.
        </li>
        <li>
          <b>Predictions</b> are a side feature: twice each trading day per market, on that market&apos;s clock, graded right or wrong at its close.
          The results are public in the track record.
        </li>
      </ul>
      <h2>How the AI is kept honest</h2>
      <ul>
        <li>Every price figure on the page comes from price data, not from the AI. A sentence with a number that isn&apos;t in the AI&apos;s input is dropped.</li>
        <li>A card can cite only reports from its own story, and every source is linked.</li>
        <li>Past events come from a checked library of 80 entries (date, measured market move, source), never from the AI&apos;s memory.</li>
        <li>No guessing without fresh data: a prediction run with missing prices is marked &quot;unavailable&quot;.</li>
      </ul>
      <h2>Where the news and prices come from</h2>
      <p>
        News comes from public RSS feeds (BBC, NPR, CNBC, Al Jazeera, VnExpress, CafeF, Vietstock, Tuổi Trẻ, Google News and other outlets).
        Prices come from free, public, unofficial sources, so they may be delayed or wrong. The AI runs on the free tiers of Google Gemini and
        Groq.
      </p>
      <h2>Not financial advice</h2>
      <p>
        Predictions are made automatically by AI and are wrong regularly. Check the track record and do your own research before any decision.
        See the <a href="/terms">Terms</a> and the <a href="/privacy">Privacy Policy</a>.
      </p>
      <h2>Source code</h2>
      <p>InvestHepi is open source under the MIT License.</p>
    </LegalPage>
  );
}
