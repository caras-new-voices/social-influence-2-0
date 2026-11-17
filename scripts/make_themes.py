"""Writes data/seed/themes.json: the themes and hooks assigned to posts from the words of their
caption. Each rule is a name and a case-insensitive regular expression (Postgres syntax, matched
against the lower-cased caption).

  python3 -I scripts/make_themes.py data/seed/themes.json

The JSON file is what the app reads. This script exists so the patterns can be edited as raw
strings; after editing, run it and commit both files.
"""
import json, re, sys

HOOKS = [
  ("Tutorial or how-to", r"how to|how i |tutorial|step by step|tips|guide\M|learn how|cómo |como hacer|comment faire|anleitung|so geht|schritt für schritt|consejos|astuce|tipps|truco|explained|walkthrough"),
  ("Review or first impressions", r"review|first impressions|honest|my thoughts|worth it|worth the hype|reseña|opini[oó]n|\mavis\M|getestet|erfahrung|bewertung|recensione|recenzj|j'ai testé|produkttest|verdict|pros and cons"),
  ("Routine or day in the life", r"routine|day in (the|my) life|\mvlog|get ready with me|grwm|with me\M|rutina|alltag|morning|night ?time"),
  ("Haul or unboxing", r"haul|unboxing|unbox|what i got|empties|restock|new in\M|package|paket"),
  ("Comparison", r"\mvs\M|versus|compar|better than|alternative|vergleich|which is better|battle"),
  ("Deal or promotion", r"discount|% off|\msale\M|\mdeals?\M|\moffer|coupon|promo|\mcode\M|rabatt|angebot|oferta|rebaja|descuento|sconto|promoção|soldes|bon plan|tiktok ?shop|link in bio|save up to|happy hour|special"),
  ("News or announcement", r"announc|breaking|\mnews\M|launch|unveil|released|just dropped|introducing|novedad|nouveau|nuovo|lançamento|coming soon|is back|now available"),
  ("Event coverage", r"\mevent|festival|live from|conference|fashion week|\mexpo\M|meetup|concert|tailgate|party|gala|awards|opening"),
  ("Humour or entertainment", r"funny|comedy|meme|joke|prank|\mlol\M|😂|🤣|humor|comedia|parody|skit"),
  ("Opinion or commentary", r"opinion|i think|unpopular|hot take|\mrant\M|debate|analysis|reaction|\mreact|thoughts on|why i |here.?s why"),
  ("Listing or sale advert", r"for sale|price:|preț|цена|ціна|продаж|в продаже|vând|se vende|disponibil|whatsapp|dm to order|lot no|prodavac|kontakt|book now|order now|call us|shop online|in stock"),
  ("Giveaway or competition", r"giveaway|\mwin\M|gewinnspiel|verlosung|sorteo|concours|participa|enter to win|competition|sweepstake"),
]

T = {}
T["hair-removal"] = [
  ("Shaving routine and how-to", r"shaving routine|how (to|i) shave|shave with me|rasier(routine|tipps)|rasiertipps|rutina de (afeitado|depilaci)|routine (de )?rasage|how to shave|shaving tips|shavingroutine|smooth shave|close shave|glatte rasur|mi rutina"),
  ("Everything shower and body care ritual", r"everything ?shower|shower ?routine|body ?care|self ?care|pamper|körperpflege|rutina de ducha|soin du corps|glow ?up|ritual|rutina de cuidado|cuidado personal"),
  ("Product review and first impressions", r"review|honest|first impressions|worth it|reseña|\mavis\M|getestet|produkttest|erfahrung|opini[oó]n|devolver|recenzj|recension|obsessed|verdict|fan de"),
  ("Intimate and sensitive areas", r"intim|bikini|maillot|zona íntima|zonas íntimas|sensitive area|empfindliche stellen|partes íntimas"),
  ("Skin concerns", r"irritat|razor burn|ingrown|rasurbrand|hautirritation|sensitive skin|empfindliche haut|piel sensible|peau sensible|rougeur|eingewachsen|\mbumps\M|strawberry legs|picor|\mitch|cuts?\M|schneiden|ziepen"),
  ("Smooth skin for summer and travel", r"summer|sommer|verano|\mété\M|estate\M|verão|holiday|vacation|urlaub|vacaciones|travel|beach|strand\M|playa|plage|\mtrip\M"),
  ("Deals and shop offers", r"tiktok ?shop|tiktokmademebuy|\mdeals?\M|dealsfürdich|angebot|oferta|rebaja|discount|rabatt|\msale\M|% off|sconto|promo|ausverkauft|sold out|precio|\mpreis|bundle"),
  ("Hauls, gift sets and empties", r"haul|gift ?set|geschenk|christmas|weihnacht|navidad|noël|empties|productos terminados|aufgebraucht|unboxing|advent|present"),
  ("Design and look", r"aesthetic|ästhet|colou?rs?\M|farbe|design|pretty|\mcute\M|pastel|\mpink\M|\mrosa\M|estétic|pleasing"),
  ("Method comparison", r"\mwax|epilat|hair removal cream|ontharingscr|enthaarungscreme|crema depilatoria|crème dépilatoire|laser|sugaring|\mvs\M|versus|método de depil|méthode|ipl\M"),
  ("Value and longevity", r"refill|subscription|\mabo\M|ersatzkling|recambio|recharge|\mlasts?\M|years with|money.?s worth|replacement blade|long.?lasting|durable"),
  ("Testing panels and gifted products", r"hometester|tester ?club|produkttest|gifted|pr package|\*gift|testen dürfen|probar gratis|\msample|muestra|kostenlos"),
  ("Brand campaigns and ambassadors", r"ambassad|embajador|botschafter|campaign|kampagne|campaña|partnership|sponsor|\mad\M|anzeige|werbung|publicidad|\mpub\M|collaboration commerciale|współpraca|giveaway|gewinnspiel|sorteo|myskinmyway"),
  ("Body hair attitudes", r"body hair|körperbehaarung|vello corporal|body positiv|my choice|normali[sz]e|hairy|have to shave|\mpoils\M|unshaven"),
  ("Men's and unisex grooming", r"\mmen'?s\M|for men|beard|\mbart\M|\mbarba\M|unisex|männer|\mhombres?\M|\mhommes?\M|barbear"),
]
T["ev-europe"] = [
  ("New model launch and first look", r"all.?new|new model|world premiere|unveil|reveal|first look|debut|launch|neue[rn]? |nouveau|nouvelle|nuevo|novo |conheça|facelift|\m2026\M|\m2027\M"),
  ("Test drive and full review", r"test ?drive|review|we drive|driven|probefahrt|\messai\M|prueba|\mtest\M|first drive|im test|walkaround|pov drive"),
  ("Price and value", r"price|\mpreis|\mprix\M|precio|preț|€|\$|cheaper|affordable|günstig|leasing|lease|discount|\meuros?\M|costs? "),
  ("Range, battery and charging", r"\mrange\M|reichweite|autonomie|autonomía|batter|akku|charg|laden\M|ladesäule|\mkwh\M|supercharger|recharge|bater[ií]a"),
  ("Software and driver assistance", r"software|\mupdate|autopilot|self.?driving|\mfsd\M|adas|driver assist|infotainment|carplay|android auto|\mota\M|autonom|robotaxi"),
  ("Chinese brands in Europe", r"chinese|china|chinois|chinesisch|chinas?\M|tariff|surtaxe|zoll|aranceles|китай"),
  ("Reliability and faults", r"problem|issue|recall|rückruf|fault|defect|broke|rust|rugin|coroziun|reliab|panne|avería|fail|complaint"),
  ("Ownership stories and running costs", r"owner|ownership|months? with|year with|\mkm\M later|running costs?|my car|living with|long.?term|daily driver|unterhalt"),
  ("Design, interior and comfort", r"design|interior|innenraum|intérieur|luxury|luxus|comfort|seats|panoramic|ambient|styling"),
  ("Performance, tuning and motorsport", r"\mamg\M|\mm ?power|horsepower|\mps\M|\mcv\M|tuning|rally|racing|formula ?1|\mf1\M|motorsport|drag race|0.?-?100|turbo|exhaust|airride|\mvrs\M|nürburgring"),
  ("Model comparison", r"\mvs\M|versus|compar|vergleich|better than|rival|alternative to|greift .* an"),
  ("Used cars, listings and parts", r"for sale|в продаже|продаж|vând|se vende|розб[оі]р|запчаст|\mkm\M|mileage|year:|двигатель|коробка|disponibil|used car|gebraucht|second.?hand|авто из|автоподбор|в пути"),
  ("Industry and policy news", r"sales (figures|rose|fell)|market share|regulat|\meu\M|union européenne|government|subsid|factory|plant|layoff|elon|musk|ceo|shares|stock|invest|quarter"),
  ("Events and meets", r"\mmeet|treffen|car show|motor show|\miaa\M|salon|congress|kongres|sraz|festival|expo"),
  ("Car culture and spotting", r"car ?spott|carsof|cartok|classic|oldtimer|youngtimer|photograph|📸|collection|garage|dream car"),
]
T["caribbean-tourism"] = [
  ("Resorts and where to stay", r"resort|hotel|all.?inclusive|villa|airbnb|where to stay|\msuite|spa\M"),
  ("Beaches and scenery", r"beach|playa|plage|\mview|sunset|turquoise|paradise|island life|ocean|waterfall|scenery|tropical"),
  ("Itineraries and things to do", r"things to do|itinerary|\mday \d|excursion|\mtour\M|must.?(see|visit|do)|guide|bucket ?list|places to|qué hacer|dia \d"),
  ("Food and drink", r"\mfood|restaurant|street food|coffee|\mrum\M|cocktail|\mdish|cuisine|comida|taste|\meat\M|brunch|dinner"),
  ("Cruises and port stops", r"cruise|\mport\M|carnival (liberty|magic|elation|cruise)|royal caribbean|shore excursion|crucero"),
  ("Honeymoons, weddings and couples", r"honeymoon|wedding|anniversar|couples?|proposal|romantic|luna de miel|boda"),
  ("Family and group trips", r"family|kids|girls.? trip|group trip|friends trip|bachelorette|birthday trip|familia"),
  ("Adventure and nature", r"snorkel|diving|\mdive\M|hik(e|ing)|rainforest|wildlife|zip.?line|surf|reef|volcan|national park|\meco|adventure|whale|turtle"),
  ("Culture, music and festivals", r"carnival|festival|\msoca\M|dancehall|reggae|dembow|music|culture|heritage|tradition|\mart\M|museum|danc"),
  ("Trip planning and cost", r"flight|\mbudget|\mcost\M|how much|travel tips|passport|visa\M|best time to|planning|packing|book(ing)? (your|now|a trip)|deal"),
  ("Safety and advisories", r"\msafe|safety|advisory|crime|hurricane|storm|warning|danger|scam"),
  ("Living there", r"moving to|move to|expat|living in|relocat|real estate|property|retire|digital nomad|residency"),
  ("National pride and diaspora", r"independence|diaspora|proud to be|orgullo|miss (universe|grand|world)|heritage month|national (day|team|anthem|hero)|patria"),
  ("Local news and community", r"\mnews\M|police|government|minister|election|school|college|community|championship|athlete|dies at|charity|fundrais"),
  ("Local business promotion", r"shop online|visit us|order now|book now|reservations?|walk-ins|boutique|salon|env[ií]os|our store|we are open|menu"),
]
T["premium-fashion"] = [
  ("Outfit of the day and styling", r"outfit|\mootd\M|look of|styling|styled|lookbook|what i wore|wearing|tenue|fit check|\mlook\M"),
  ("Hauls, unboxing and new purchases", r"haul|unboxing|unbox|new in\M|just bought|purchase|\mbought\M|shopping"),
  ("Bags and leather goods", r"\mbags?\M|handbag|tote|\msac\M|borsa|bolso|backpack|рюкзак|сумк|leather|wallet|purse|pliage|crossbody"),
  ("New collection and campaign", r"new collection|collection|campaign|drop(s|ping|ped)?\M|capsule|fall.?winter|spring.?summer|\mfw\d|\mss\d|lookbook|nouvelle collection|coleç|colección"),
  ("Fashion week and shows", r"fashion week|\mnyfw|\mpfw|\mlfw|\mmfw|runway|catwalk|défilé|\mshow\M|front row"),
  ("Celebrity, ambassadors and red carpet", r"ambassador|red carpet|celebrity|\mstars?\M|actress|actor|wears|wearing .* at|premiere|met gala|house ambassador"),
  ("Fragrance and beauty lines", r"fragrance|perfume|parfum|profumo|eau de|scent|kvepal|beauty|makeup|lipstick"),
  ("Sales, outlet and discounts", r"\msale\M|outlet|discount|% off|soldes|rebajas|saldi|promo|best price|лучшая цена|€"),
  ("Resale, vintage and second-hand", r"vintage|second.?hand|pre.?loved|vinted|thrift|charity ?shop|resale|auction|rare find|depop"),
  ("Reseller and wholesale listings", r"lot no|\mstock\M|wholesale|mix stock|new arrival|prodavac|dostupn|dm to order|whatsapp|available sizes|размер|цвет"),
  ("Personalisation and gifting", r"personali[sz]|monogram|engrav|gift|cadeau|regalo|geschenk"),
  ("Brand heritage and the designer's story", r"heritage|legacy|iconic|history|founder|archive|since \d{4}|tribute|a laissé|designer"),
  ("Stores, events and brand experiences", r"boutique|store opening|flagship|pop.?up|\mevent|dinner|dîner|invited|invitée|prize|exhibition|festival"),
  ("Menswear and tailoring", r"menswear|men'?s (fashion|style)|\msuit\M|tailor|\mblazer|tie\M|homme|uomo"),
  ("Quality and authenticity", r"authentic|\mfake|\mreal vs|counterfeit|quality|original\M|100% ?(cotton|bomuld)|made in"),
]
T["enterprise-tech"] = [
  ("AI and agents", r"\mai\M|artificial intelligence|\magents?\M|generative|genai|\mllm|chatgpt|copilot|gemini|watsonx|machine learning|\mml\M"),
  ("Cloud and infrastructure", r"\mcloud\M|data ?cent(er|re)|infrastructure|\maws\M|azure|kubernetes|server|compute|\mgpu|hybrid cloud"),
  ("Cybersecurity", r"security|cyber|hack|breach|malware|ransomware|phishing|\msoc\M|\miam\M|zero trust|vulnerab"),
  ("Data and analytics", r"big ?data|analytics|data science|database|\msql\M|warehouse|bigquery|vertex|tensorflow|data engineer"),
  ("Developer tools and coding", r"github|open ?source|developer|coding|programming|python|\mapi\M|\msdk\M|devops|\mcode\M|build tool|frontend"),
  ("Everyday software how-tos", r"how to|tutorial|\mword\M|excel|powerpoint|google (forms|docs|sheets|tasks|drive)|outlook|\mteams\M|windows (10|11)|step.?by.?step"),
  ("Courses, certifications and careers", r"certificat|\mcourse|training|career|interview|resume|\mjob|internship|hiring|bootcamp|students?|learn"),
  ("Company news and finance", r"earnings|revenue|stock|shares|valuation|most valuable|acqui|layoff|\mdeal\M|billion|market cap|investor|files"),
  ("Product launches and conferences", r"launch|announc|keynote|conference|summit|re:invent|\mignite\M|\mbuild\M 20|unveil|new feature|release"),
  ("Leadership and customer stories", r"\mceo\M|leadership|executive|global head|customer (story|voice)|case study|podcast|episode|sits down|interview with"),
  ("Regulation and legal", r"antitrust|regulat|lawsuit|\mcourt|\mftc\M|\mdoj\M|breakup|ruling|compliance|privacy law"),
  ("Research and emerging technology", r"quantum|\mchips?\M|semiconductor|research|breakthrough|\mlab\M|qubit"),
  ("Consumer devices and gaming", r"xbox|gaming|\mgame|surface|windows pc|laptop|console|playstation"),
  ("Sponsorships and brand presence", r"sponsor|us ?open|wimbledon|masters|partner(ship)?|presented by|campus|hackathon"),
  ("Technology history and culture", r"history|in 19\d\d|decades|first computer|vintage|nostalg|legacy|pioneer"),
]
T["sleep-tech"] = [
  ("Product review and setup", r"review|setting up|set ?up|unboxing|worth (it|the hype)|first impressions|honest|my experience|months? (with|later)"),
  ("Sleep temperature and cooling", r"cool(ing|er)?\M|temperature|sleep(ing)? hot|hot sleeper|\mheat|thermo|chil|night sweats"),
  ("Sleep tracking and scores", r"sleep (score|tracking|data|stages)|\mhrv\M|heart rate|readiness|\mrem\M|deep sleep|tracker|metrics|sleep apnea"),
  ("Recovery, training and performance", r"recovery|training|workout|athlete|marathon|running|\mstrain|lifting|gym|performance|\mfitness"),
  ("Health and longevity science", r"longevity|neuroscien|huberman|biohack|science|study|research|doctor|\mdr\.|health|peptide|glp-1|metabol"),
  ("Device comparison", r"\mvs\M|versus|compar|alternative|better than|which (one|is)|screenless"),
  ("Subscription, price and value", r"subscription|\$\d|per month|/month|price|expensive|worth the money|membership|paying"),
  ("Deals and seasonal sales", r"\msale\M|labor day|black friday|save up to|% off|discount|\mdeals?\M|promo|code\M"),
  ("New products and features", r"launch|announc|introducing|next evolution|\m2\.0\M|unveil|just dropped|new (feature|model|version|product|generation)|is here\M"),
  ("Accessories and add-ons", r"\mband|strap|charger|charging|\mcase\M|accessor|watch ?face|dock"),
  ("Night routine and bedroom setup", r"night ?(time)? routine|bedtime|bedroom|bed ?sheets|bedding|pillow|wind down|morning routine|reset"),
  ("Mattress and comfort", r"mattress|firm|memory foam|back pain|comfort|topper|adjustable|pressure"),
  ("Women's health", r"women'?s health|female|\mcycle\M|menopause|pregnan|hormon|period\M"),
  ("Sponsor reads in unrelated content", r"sponsor|my partner|use code|thanks to .* for sponsoring|brought to you|\*sponsor|partnered"),
  ("Giveaways and partnerships", r"giveaway|\mwin\M|enter|teaming up|entries|take home a free|sweepstake"),
]
T["hair-care"] = [
  ("Wash routine and how-to", r"wash ?day|hair ?care ?routine|routine|how (to|i) wash|shampoo(ing)? (routine|tips)|rutina|rotina|step by step|tips"),
  ("Dandruff and scalp care", r"dandruff|scalp|flak|itch|caspa|seborr|oil control|anti.?dandruff"),
  ("Damage repair and bond building", r"repair|bond|damage|breakage|strength|restor|reparaci|k18results|heat damage|bleach damage"),
  ("Salon colour and stylist work", r"balayage|highlight|blonde|brunette|bronde|toner|toned|colou?r(ist)?|grey blending|foil|lightener|stylist|salon"),
  ("Before and after results", r"before (and|&) after|antes y después|antes e depois|transformation|results|reaction"),
  ("Product review and first impressions", r"review|first impressions|honest|worth it|tried|trying|opini|thoughts|did not like|obsessed|amazing"),
  ("Deals, bundles and restocks", r"bundle|restock|tiktok ?shop|\mdeals?\M|\msale\M|% off|discount|grab (this|it)|before it.?s gone"),
  ("PR packages and gifted hauls", r"\mpr\M|gifted|package|haul|unboxing|thank you .* for sending|sent me"),
  ("Hair growth and hair loss", r"hair growth|growth|hair loss|thinning|ca[ií]da|anti.?ca[ií]da|shedding|fall out|bald|calvo"),
  ("Ingredients and science", r"ingredient|formula|niacinamide|pro.?v|vitamin|peptide|sulfate|silicone|protein|science|chemist"),
  ("Styling and heat", r"styling|blow ?out|blow ?dry|curling|waves|ondas|heat protect|hairstyle|peinado|updo|straighten"),
  ("Curly and textured hair", r"curly|curls|coily|wavy|textured|natural hair|\m4c\M|\m3[abc]\M|rizos|cachos"),
  ("Scent and feel", r"smell|scent|fragrance|residue|lightweight|greasy|soft|shiny|olor|cheiro|cooling sensation|mint"),
  ("Stylist education and the salon business", r"academy|education|class\M|educator|behind the chair|book now|clients?|salon owner|cutting skills"),
  ("DIY and hacks", r"\mdiy\M|hack|homemade|casero|trick|mix(ed|ing)? (it|with)|agregué|rosemary|romero"),
  ("Ambassadors and campaigns", r"ambassador|campaign|partner|#ad\M|\mad\M|sponsored|associat|actress|celebrity"),
]
T["spirits"] = [
  ("Bottle review and tasting notes", r"review|tasting notes?|\mnose\M|palate|finish|\mproof\M|pour|sipp|neat\M|rating|first taste"),
  ("Bottle hunting and rare releases", r"hunting|allocated|limited|rare|store pick|private selection|single barrel|\d\d year|release|is back|unicorn|secondary"),
  ("Cocktail recipes and how-to", r"cocktail|recipe|old fashioned|margarita|manhattan|mixolog|how to make|\moz\M|shake|stir|garnish|highball"),
  ("Bar and restaurant specials", r"happy hour|specials?\M|\$\d|menu|\mwings\M|domestics|bucket|every (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|well drinks|taco"),
  ("Events, music and nightlife", r"live music|\mdj\M|party|concert|festival|night ?club|\mlive\M|stage|tonight|costume|karaoke"),
  ("Sport and game day", r"\mnfl\M|football|game ?day|tailgate|college games|watch party|\mufc\M|baseball|basketball"),
  ("Distillery visits and tourism", r"distillery|tour\M|tasting room|bourbon trail|kentucky|visitor|rickhouse|warehouse"),
  ("Food pairing and cooking", r"pairing|burger|steak|\mbbq\M|recipe|glaze|dinner|cook|dessert|cigar"),
  ("Ready-to-drink and canned cocktails", r"canned|seltzer|ready.?to.?drink|\mrtd\M|\mcans?\M|hard (tea|seltzer)|variety pack"),
  ("Collections and the home bar", r"collection|home bar|shelf|shelfie|bottle ?kill|backbar|bunker|bar cart"),
  ("Seasonal and gifting", r"\mfall\M|autumn|holiday|christmas|halloween|thanksgiving|gift|summer|labor day|season"),
  ("Brand heritage and how it is made", r"heritage|history|since \d{4}|mash ?bill|barrel|aged|distill(ed|er|ing)|master distiller|char|tradition"),
  ("Sponsorships and partnerships", r"sponsor|partner|presented by|#ad\M|\mad\M|collab|ambassador"),
  ("Price, value and where to buy", r"price|msrp|costco|total wine|liquor store|worth the|value|budget|under \$|shelf finds?|find"),
  ("Comparisons and blind tastings", r"\mvs\M|versus|blind|compar|battle|head to head|ranking|ranked|tier list"),
  ("Moderation and sobriety", r"sober|detox|drink responsibly|quit drinking|moderation|hangover|alcohol.?free|21\+"),
]
T["nfl-new-york"] = [
  ("Game recap and highlights", r"recap|highlights?|final score|winners (&|and) losers|defeat|beat the|postgame|reaction to|\mwin\M|\mloss\M"),
  ("Game preview and predictions", r"preview|prediction|week \d|matchup|keys to|what to watch|\mvs\.?\M|odds|will .* this season"),
  ("Player performance and profiles", r"rookie|touchdown|yards|catch|sack|interception|breakout|star\M|highlight reel|teach tape|praise"),
  ("Quarterback and roster debate", r"quarterback|\mqb\M|starter|depth chart|roster|53.?man|cuts?\M|position battle|bench"),
  ("Injuries", r"injur|\macl\M|hamstring|concussion|out for|questionable|\mir\M|sidelined|surgery"),
  ("Draft, trades and free agency", r"draft|trade|free agen|sign(ed|ing|s)\M|contract|extension|waive|released"),
  ("Coaching and front office", r"coach|coordinator|general manager|\mgm\M|front office|owner|scheme|play.?call|fired|hired"),
  ("Training camp and preseason", r"training camp|preseason|practice|camp\M|joint practice|otas?\M|minicamp"),
  ("Fantasy football and betting", r"fantasy|best ball|\mdfs\M|rankings|sleepers?|prizepicks|bet(s|ting)?\M|parlay|draftkings|start.?em|waiver"),
  ("Team history and classic moments", r"history|super bowl|classic|throwback|legend|helmet catch|all.?time|greatest|\b(19|20)\d\d season|retired"),
  ("Fan culture and game day", r"\mfans?\M|tailgate|metlife|game ?day|season ticket|kickoff party|fanbase|chant"),
  ("Team business and franchise value", r"franchise value|billion|ownership|stadium|ticket prices?|revenue|sponsor|valuation"),
  ("League-wide news that mentions the team", r"around the (nfl|league)|every team|all 32|power rankings|league.?wide|nfl news|welcome to the team"),
  ("Video games and simulations", r"madden|simulation|\msim\M|gameplay|franchise mode|ultimate team"),
  ("Merchandise and memorabilia", r"jersey|memorabilia|autograph|trading cards?|collectible|signed (jersey|helmet|ball|football)|bobblehead|pro shop"),
]
T["nation-brand"] = [
  ("Conflict and security news", r"\marmy\M|military|strike|missile|rocket|attack|\midf\M|soldier|troops|الجيش|عدوان|צה.?ל|war\M|guerre|ceasefire|إنذار|غارة"),
  ("Gaza and the humanitarian situation", r"gaza|غزة|עזה|humanitarian|\maid\M|famine|displac|refugee|hospital|civilians|children|شهيد"),
  ("Regional tensions", r"\miran|إيران|ایران|lebanon|لبنان|hezbollah|houthi|syria|yemen|حزب الله|الحوثي"),
  ("Diplomacy and international response", r"united nations|\mun\M|الأمم المتحدة|sanction|عقوبات|ambassador|embassy|recogni[sz]|resolution|summit|foreign minister|diplomat|press conference"),
  ("Protest and solidarity", r"protest|demonstrat|march\M|rally|boycott|solidarity|free ?palestine|stand with|manifestation|took to the streets|flotilla"),
  ("Domestic politics and government", r"knesset|netanyahu|نتنياهو|נתניהו|ben.?gvir|minister|government|coalition|election|הממשלה|ראש העירייה|cabinet"),
  ("Hostages, prisoners and detainees", r"hostage|prisoner|detain|captiv|أسرى|חטופ|released from|prison"),
  ("Media coverage and commentary", r"media|headline|coverage|journalis|propaganda|narrative|analysis|opinion|acceptable to say|debate"),
  ("Hate incidents and the debate about them", r"antisemit|anti-semit|islamophob|hate (crime|speech)|racis|discriminat"),
  ("Religion and faith", r"prayer|pray|bible|torah|quran|scripture|jerusalem|القدس|ירושלים|temple|mosque|synagogue|church|الكوتل|הכותל|holy|blessed|\mgod\M|الله"),
  ("History and commemoration", r"history|anniversar|memorial|remember|holocaust|1948|1967|nakba|commemorat|disparition|in memory"),
  ("Culture, food and daily life", r"food|recipe|kitchen|music|\mart\M|film|festival|daily life|street|market|culture|tel aviv|تطبيق|אפליקציה"),
  ("Travel and tourism", r"travel|tourism|tourist|visit(ing)?\M|trip|flight|hotel|vacation"),
  ("Technology, business and innovation", r"startup|tech\M|innovation|economy|invest|company|cyber|export|\mhi.?tech"),
  ("Diaspora and community life", r"diaspora|community|jewish community|congregation|students? (group|union)|campus|federation"),
  ("Public diplomacy", r"more to israel.?s story|beyond the headlines|the truth about|learn the facts|hasbara|fact.?check|myth"),
]

out = {"version": 1,
       "note": "Themes and hooks assigned from the words of a post's caption. Each rule is a name and a regular expression matched against the lower-cased caption. A post can have several themes.",
       "hooks": [{"name": n, "pattern": p} for n, p in HOOKS],
       "industries": {k: [{"name": n, "pattern": p} for n, p in v] for k, v in T.items()}}
for k, v in T.items():
    assert len({n for n, _ in v}) == len(v), k
    for n, p in v:
        assert p == p.lower() or True
json.dump(out, open(sys.argv[1], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("industries", len(T), "themes", sum(len(v) for v in T.values()), "hooks", len(HOOKS))
