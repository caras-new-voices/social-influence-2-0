# Accuracy report

Written by `npm run check:accuracy` on 18 November 2026. Judge: gpt-5.5, blind to our answer. Pass mark: 90%.
This is agreement with a stronger model, not a human check. The rows listed under each check are the ones to read by hand.

## Summary

- **Pass: Paid, gifted or neither, on a random sample of posts** 97% (145 of 150)
- **Pass: Posts shown as paid from the caption: is a paid disclosure there?** 96% (77 of 80)
- **Pass: Posts kept in the dashboards: about the brand they are filed under?** 98% (147 of 150)
- **FAIL: Comments: about the brand or category, or not?** 89% (266 of 300)
- **FAIL: Brand comments: the right one of the six attributes?** 87% (130 of 150)
- **Pass: Comments counted as buying signals: are they?** 92% (138 of 150)
- **Pass: "Questions about the brand that nobody answered": about the brand?** 98% (171 of 175)
- **Pass: "Earned creators, never paid": no disclosure in their captions?** 94% (101 of 108)

## By check

### Paid, gifted or neither, on a random sample of posts

- hair-removal: 97% (145 of 150)
    - we say paid, judge says none: Maszynki do golenia Gillette Venus dostępne w kilku wariantach w drogerii Hebe, bez trudu znajdziesz model dopasowany do swoich potrzeb 👉nie
    - we say paid, judge says gifted: 🎁🏉CONCOURS X INTUITION BY WILKINSON : à l’occasion de la finale de la coupe du monde de rugby féminine à laquelle j’ai eu la chance d’assist
    - we say paid, judge says none: Te surge un planazo de piscina de última hora y no estás depilada... 🫣 Desastre evitado. Menos mal que llevo la Philips OneBlade Intimate en

### Posts shown as paid from the caption: is a paid disclosure there?

- hair-removal: 96% (77 of 80)
    - we say paid, judge says none: Сутрините ми са като малък маратон - бързи, шумни, хаотични и почти никога няма време за мен. Всичко се върти около Давид - хранене, разходк
    - we say paid, judge says none: I always blamed my skin… turns out I should’ve been looking at my razor instead. 🤍 If post-shave irritation sounds familiar, I’ve linked the
    - we say paid, judge says gifted: 🎁🏉CONCOURS X INTUITION BY WILKINSON : à l’occasion de la finale de la coupe du monde de rugby féminine à laquelle j’ai eu la chance d’assist

### Posts kept in the dashboards: about the brand they are filed under?

- hair-removal: 98% (147 of 150)
    - kept under Estrid (our label: yes), judge says not about it: First working week of January complete so let’s spend a cosy Friday evening routine together!!! sorry I’ve not posted a vlog in a week getti
    - kept under Estrid (our label: yes), judge says not about it: heavy on the last slide 🛝
    - kept under Venus (our label: passing), judge says not about it: restaurandoci con il 🩸 attrezzi del restauro: @dm_italia @dm_alverde siero all’avena per la cute @gyadacosmetics - impacco modellante ricci 

### Comments: about the brand or category, or not?

- hair-removal: 89% (266 of 300)
    - we say creator, judge says category: I need to do an everything shower into the weekend... helpful during school!
    - we say creator, judge says brand: Love it 😍
    - we say noise, judge says brand: Oops

### Brand comments: the right one of the six attributes?

- hair-removal: 87% (130 of 150)
    - we say service, judge says durability (brand): Gibt's bestimmt auch bei Rossmann 👌 in viel stabiler ✊
    - we say price, judge says none (brand): it's a premium brand
    - we say ease, judge says safety (category): Und Peeling benutzen vor dem rasieren !!

### Comments counted as buying signals: are they?

- hair-removal: 92% (138 of 150)
    - counted as a buying signal, judge says no: Wish I could’ve been there but I have college?
    - counted as a buying signal, judge says no: After sending this I remembered I had a small tube in the back of the cupboard so I’ve used it to shave my legs this morning. I always suffe
    - counted as a buying signal, judge says no: These are perfect

### "Questions about the brand that nobody answered": about the brand?

- Estrid: 98% (39 of 40)
    - listed as a brand question, judge says no: Anything for Underarm Odor in summer
- Veet: 98% (39 of 40)
    - listed as a brand question, judge says no: pareil j’en ai mais pas de sopk, pourquoi on a ça alors
- Venus: 100% (40 of 40)
- Philips OneBlade: 95% (38 of 40)
    - listed as a brand question, judge says no: Як давно ви її зробили?
    - listed as a brand question, judge says no: mira a ver si sale ahora
- Wilkinson Sword: 100% (15 of 15)

### "Earned creators, never paid": no disclosure in their captions?

- Estrid: 100% (20 of 20)
- Veet: 100% (20 of 20)
- Mercadona: 100% (8 of 8)
- Venus: 80% (16 of 20)
    - andreeasuciu111 is listed as never paid, judge sees gifted: Blue matcha, gifts & a lot of good energy în noul magazin BIPA din Mega Mall. Iubesc ca am făcut asta alături de Gillette Venus🩵🤍👐🏼 #Gillett
    - rebeccadigirolamo_ is listed as never paid, judge sees gifted: Ti depili con la lametta ma non usi un gel o schiuma? Prova questa routine! 🎁ogni giorno scelgo tra i commenti una persona a cui fare un reg
    - antoniasarafova is listed as never paid, judge sees gifted: Някой ползва една и съща самобръсначка за цялото тяло! 🫢 Не и по време на моята смяна като Smoothguard! 🎀 Различните части от тялото ни имат
- Philips OneBlade: 90% (18 of 20)
    - normal_norge is listed as never paid, judge sees gifted: Er du også helt jungel for tiden? Ta det rolig, det er helt normalt!🤭 Bli med å teste nyheten fra Philips - OneBlade Intimate💚 Produktet er 
    - ida_prester is listed as never paid, judge sees paid: ‘Moj muž ne želi spavati s bakom’ 😂 Operna diva @sandra_bagaric nam na svoj šarmantan i duhovit način opisuje vlastito iskustvo starenja, st
- Wilkinson Sword: 95% (19 of 20)
    - tialeoniwright is listed as never paid, judge sees paid: My Bath Routine 🫧 & a load of my favourite products that I cannot live without x I added (nearly all) my holy grail products to my @amazonuk

