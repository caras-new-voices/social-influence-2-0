# Accuracy report

Written by `npm run check:accuracy` on 23 November 2026. Judge: gpt-5.5, blind to our answer. Pass mark: 90%.
This is agreement with a stronger model, not a human check. The rows listed under each check are the ones to read by hand.

## Summary

- **Pass: Paid, gifted or neither, on a random sample of posts** 97% (146 of 150)
- **Pass: Posts shown as paid from the caption: is a paid disclosure there?** 98% (78 of 80)
- **Pass: Posts shown as affiliate or shop: does the caption show it?** 99% (79 of 80)
- **Pass: Posts kept in the dashboards: about the brand they are filed under?** 98% (147 of 150)
- **FAIL: Comments: about the brand or category, or not?** 90% (269 of 300)
- **Pass: Brand comments: the right one of the six attributes?** 95% (143 of 150)
- **Pass: Comments counted as buying signals: are they?** 100% (150 of 150)
- **Pass: "Questions about the brand that nobody answered": about the brand?** 94% (166 of 177)
- **Pass: "Earned creators, never paid": no disclosure in their captions?** 94% (101 of 108)

## By check

### Paid, gifted or neither, on a random sample of posts

- hair-removal: 97% (146 of 150)
    - we say paid, judge says none: Maszynki do golenia Gillette Venus dostępne w kilku wariantach w drogerii Hebe, bez trudu znajdziesz model dopasowany do swoich potrzeb 👉nie
    - we say paid, judge says gifted: 🎁🏉CONCOURS X INTUITION BY WILKINSON : à l’occasion de la finale de la coupe du monde de rugby féminine à laquelle j’ai eu la chance d’assist
    - we say paid, judge says none: Te surge un planazo de piscina de última hora y no estás depilada... 🫣 Desastre evitado. Menos mal que llevo la Philips OneBlade Intimate en

### Posts shown as paid from the caption: is a paid disclosure there?

- hair-removal: 98% (78 of 80)
    - we say paid, judge says none: Сутрините ми са като малък маратон - бързи, шумни, хаотични и почти никога няма време за мен. Всичко се върти около Давид - хранене, разходк
    - we say paid, judge says gifted: 🎁🏉CONCOURS X INTUITION BY WILKINSON : à l’occasion de la finale de la coupe du monde de rugby féminine à laquelle j’ai eu la chance d’assist

### Posts shown as affiliate or shop: does the caption show it?

- hair-removal: 99% (79 of 80)
    - we say affiliate or shop, judge says no: FINALLY BACK IN STOCK!!! @Estrid #tiktokshopmademebuyit #estrid #razor

### Posts kept in the dashboards: about the brand they are filed under?

- hair-removal: 98% (147 of 150)
    - kept under Estrid (our label: yes), judge says not about it: First working week of January complete so let’s spend a cosy Friday evening routine together!!! sorry I’ve not posted a vlog in a week getti
    - kept under Estrid (our label: yes), judge says not about it: heavy on the last slide 🛝
    - kept under Venus (our label: passing), judge says not about it: restaurandoci con il 🩸 attrezzi del restauro: @dm_italia @dm_alverde siero all’avena per la cute @gyadacosmetics - impacco modellante ricci 

### Comments: about the brand or category, or not?

- hair-removal: 90% (269 of 300)
    - we say creator, judge says category: I need to do an everything shower into the weekend... helpful during school!
    - we say creator, judge says brand: Love it 😍
    - we say noise, judge says brand: Oops

### Brand comments: the right one of the six attributes?

- hair-removal: 95% (143 of 150)
    - we say durability, judge says efficacy (brand): C’est après combien de temps cette repousse , j’ai jamais eu de poils aussi long de ma life lol
    - we say service, judge says none (brand): oh noooo ihr wart einfach zu meinem geburtstag am 23.10. bei mir an der uni in leipzig und ich sehe es erst jetzt. wie traurig 😭 das hätte m
    - we say service, judge says none (brand): Was soll das sein und wann ?? @gillettevenusde

### Comments counted as buying signals: are they?

- hair-removal: 100% (150 of 150)

### "Questions about the brand that nobody answered": about the brand?

- Estrid: 85% (34 of 40)
    - listed as a brand question, judge says no: What’s the point of the body scrub if you already exfoliated
    - listed as a brand question, judge says no: Which soap is good
    - listed as a brand question, judge says no: How do you exfoliate ur face
- Veet: 98% (39 of 40)
    - listed as a brand question, judge says no: pareil j’en ai mais pas de sopk, pourquoi on a ça alors
- Venus: 100% (40 of 40)
- Philips OneBlade: 92% (37 of 40)
    - listed as a brand question, judge says no: Tu ne continues plus la lumière pulsée à la maison ?
    - listed as a brand question, judge says no: Ви коли йшли на лезерну епіляцію, ви хоть щось про неї знали??
    - listed as a brand question, judge says no: "Pour ta « crème » tu met autant de beurre de kariter/ huile de coco et beurre de cacao ou y’en a 1 que tu met plus que les autres merci"
- Wilkinson Sword: 94% (16 of 17)
    - listed as a brand question, judge says no: Wie oft machst du das?

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

