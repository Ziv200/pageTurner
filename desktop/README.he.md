<div dir="rtl">

# PageTurner למק

התוכנה מציגה את התווים שלך באייפד, ועוברת לשיר ולעמוד הנכונים כשהמק שולח MIDI Program Change (למשל מאייבלטון).
PageTurner יושבת ב**שורת התפריטים** (אייקון של דף, למעלה מימין), ואין לה אייקון ב-Dock.

היא עובדת בכל מק עם macOS 11 ומעלה, גם Apple Silicon (M1–M4) וגם Intel, בהורדה אחת ("universal").

## התקנה
1. פתחו את `PageTurner-1.0.0-universal.dmg` וגררו את **PageTurner** אל **Applications**.
2. פתחו את PageTurner מתיקיית היישומים. **בפעם הראשונה** macOS יגיד שאי אפשר לפתוח אותה, או שאי אפשר לאמת את המפתח.
   זה צפוי, כי האפליקציה לא חתומה בתעודת מפתח בתשלום של אפל.
   - לחצו **סיום** (לא "העבר לפח").
   - פתחו **הגדרות מערכת › פרטיות ואבטחה**, גללו למטה עד ‎"PageTurner" was blocked‎, לחצו **פתח בכל זאת** (Open Anyway) ואשרו עם סיסמה או Touch ID.
   - צריך לעשות את זה רק פעם אחת.
3. אם macOS שואל אם לאפשר ל-PageTurner **למצוא מכשירים ברשת המקומית**, לחצו **אפשר**. האייפד צריך את זה.

## הגדרה ראשונה (נפתחת לבד; אחר כך דרך שורת התפריטים › Setup…)
1. **תיקיית פרויקטים.** ברירת המחדל היא `‎~/PageTurnerProjects`. סמנו *Sample Project* כדי לקבל 3 שירים לדוגמה.
2. **MIDI.** לחצו *Open Audio MIDI Setup* › Window › Show MIDI Studio › לחיצה כפולה על **IAC Driver** › סמנו **Device is online** › Apply.
   בחרו את ה-IAC bus תחת *Listen to*. שלחו Program Change מאייבלטון, והוא יופיע תחת *Last Program Change*.
3. **אייפד.** חברו את האייפד לאותו Wi-Fi, או בכבל USB עם *שיתוף אינטרנט* דלוק. סרקו את קוד ה-QR במצלמה של האייפד.
   ב-Safari לחצו שיתוף › **הוסף למסך הבית**.

## שימוש
- **Composer** (שורת התפריטים › Open Composer): מוסיפים קובצי PDF וממפים מספרי Program Change (1–128, כמו שאייבלטון מציג אותם) לשיר ולעמוד,
  ואז לוחצים **Save & Activate**. השירים ממוינים לפי המספר שבתחילת שם הקובץ.
- **באייפד** מעבירים עמוד בהקשה על הקצה הימני או השמאלי, או עם דוושת Bluetooth (חיצים או מקשי Page).
  תג אדום אומר שהאייפד איבד את המק, והחיבור יחזור לבד. תג כתום אומר שאין קלט MIDI.
- בהופעות כדאי להגדיר באייפד **הגדרות › תצוגה ובהירות › נעילה אוטומטית › אף פעם**.
- בשורת התפריטים מופיעים כתובת האייפד (לחיצה מעתיקה אותה), קלט ה-MIDI, ה-Program Change האחרון והפרויקט הפעיל.
  יש שם גם Open Projects Folder, Show Log, Launch at Login ו-Quit. היציאה עוצרת את השרת.
- אם פורט 3000 תפוס, האפליקציה עוברת לפורט הפנוי הבא ומציגה אותו בתפריט. היא אף פעם לא משתמשת בפורט 80, כך ש-AbleSet לא נפגע.

## תקלות
- **"No MIDI input"**: הדליקו את ה-IAC Driver (שלב 2 למעלה), ואז בחרו אותו בשורת התפריטים › MIDI input.
- **האייפד לא פותח את הדף**: ודאו ששני המכשירים באותה רשת, ונסו את הכתובת השנייה שמופיעה בתפריט. בחיבור USB, כבו והדליקו מחדש את שיתוף האינטרנט.
- **שמירה על פרויקט קיים** שומרת את הגרסה הקודמת בשם `‎<name>.pdset.bak`.

</div>

---

<div dir="rtl">

## Windows (10 / 11)

**התקנה:** הורידו את `PageTurner-Setup-1.0.0-x64.exe` (או `-arm64.exe` למחשבי ARM) והריצו. ההתקנה לא חתומה, לכן **SmartScreen** יציג "Windows protected your PC" ← לחצו **More info ← Run anyway**.

**פורט MIDI וירטואלי (loopMIDI):** ל-Windows אין מקבילה מובנית ל-IAC Driver של המק.
1. התקינו את **loopMIDI** החינמי: https://www.tobias-erichsen.de/software/loopmidi.html
2. פתחו אותו ולחצו **+** ליצירת פורט (למשל "loopMIDI Port"). השאירו אותו פועל (אפשר להפעיל עם Windows).
3. באבלטון: *Options › Preferences › Link, Tempo & MIDI* ← הפעילו **Track** בפלט "loopMIDI Port" ושלחו אליו Program Change.
4. בחלון ההגדרה של PageTurner לחצו **Refresh list** ובחרו "loopMIDI Port".

**חומת האש של Windows:** בהפעלה הראשונה Windows ישאל אם לאפשר ל-PageTurner גישה לרשת. סמנו **Private networks** ולחצו **Allow** – אחרת האייפד לא יתחבר. (ודאו שרשת ה-Wi-Fi מוגדרת כ-*Private*.) אם לחצתם Cancel: *Windows Security › Firewall › Allow an app through firewall* ← הפעילו את PageTurner (Private).

**איפה הכול:** PageTurner נמצא באזור ההודעות ליד השעון (לחצו **^** אם מוסתר); לחיצה על האייקון פותחת את התפריט. פרויקטים: `C:\Users\<you>\PageTurnerProjects`; הגדרות ולוג: `%APPDATA%\PageTurner`. "Launch at Login" מוסיף את PageTurner לאפליקציות ההפעלה.

</div>
