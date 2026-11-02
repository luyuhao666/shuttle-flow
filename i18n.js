(() => {
'use strict';
// English is the source language. This presentation layer never changes rules,
// saved gameplay values or input identifiers. All translations ship offline.
const storageKey = 'shuttle-flow-language';
const dictionary = Object.freeze(Object.fromEntries(`
Language|语言
Choose your language. Changes apply immediately.|选择界面语言，切换后立即生效。
Settings|游戏设置
MAKE IT YOURS|按你的习惯来
Auto-save|自动保存
✓ Saved|✓ 已保存
Not saved|本次未能保存
Court Guidance|场内提示
Court guidance level|场内提示详细程度
Compact|简洁
Full|完整
Compact keeps court cues. Full adds shot and control tips.|简洁模式保留场内提示圈；完整模式增加球路和操作说明。
Sound|音效
On|开启
Off|关闭
Volume|音量
Muted|静音
♪ Preview hit sound|♪ 试听击球音效
↺ Reset defaults|↺ 恢复默认
Reset defaults|恢复默认
Default shot power|默认击球力度
Default clear power|高远球默认力度
Default drop power|吊球默认力度
Default power for standing and jump smashes|点杀与跳杀默认力度
Light|轻
Medium|中
Strong|重
Clear|高远球
Drop|吊球
Attack|进攻
Lift|挑球
Block|挡网
Drive|平抽
Smash|杀球
Standing smash|点杀
Jump smash|跳杀
JUMP SMASH|跳杀
DROP SHOT|吊球
PERFECT|完美击球
GOOD|好球
Backhand|反手
Front|正面
Back view|背面
Back|返回
Done & Back|完成并返回
THE DAILY COURT|今日球场
BADMINTON CLUB|羽毛球俱乐部
Your court. Your rhythm.|你的球场，你的节奏。
Practice|练习模式
PRACTICE|练习模式
Match|比赛
Match Mode|比赛模式
Training|专项练习
Personalize|个性化
Find your rhythm|找准击球节奏
Take on your next opponent|迎战下一位对手
Make every shot count|练好每一次回球
Your colors, your court|打造你的专属球场
Fine-tune your game|调整游戏体验
New here?|初次上场？
Tutorial|新手教程
Modes and settings|模式与设置
Start the on-court beginner tutorial|开始球场新手教程
Replay the on-court beginner tutorial|重玩球场新手教程
FIND YOUR RHYTHM|找准你的节奏
CHOOSE YOUR OPPONENT|选择你的对手
ONE SHOT AT A TIME|一球一球练好
← Back|← 返回
Back to home|返回首页
Back to menu|返回主菜单
Back to home|返回首页
Choose an opponent and play a full match.|选择对手，进行一场完整比赛。
Practice footwork, strokes, and jump smashes with CPU feeds.|通过人机喂球练习跑位、回球和跳杀。
Unlimited feeds, a rising pace, and a session summary.|不限喂球数量，节奏逐步加快，结束后查看练习总结。
Feed Practice|喂球练习
Target Challenge|落点挑战
Practice type|练习类型
Unlimited|不限球数
Unlimited practice|不限球数练习
Keep going after a miss. Find your own rhythm.|失误后继续练习，找到自己的节奏。
Move · Hit · Jump smash|跑位 · 回球 · 跳杀
The pace builds as you return. Review your session when done.|成功回球后节奏逐步加快，结束时查看练习总结。
Target area|目标区域
Mixed|综合
Deep|后场
Net|下网
Target challenge drill|落点挑战类型
Target challenge length|落点挑战球数
Session length|练习球数
Hit the target: +100. Hit the center: +150.|命中目标得 100 分，命中中心得 150 分。
Aim for the target. Use shot type and power to control depth.|瞄准目标，用球种和力度控制回球深度。
All targets|综合目标
Deep targets|后场目标
Net targets|网前目标
Left Net|左侧网前
Right Net|右侧网前
Left Midcourt|左侧中场
Right Midcourt|右侧中场
Left Deep|左侧后场
Right Deep|右侧后场
Points to Win|获胜分数
Choose your target score and set the pace.|选择比赛分数，按你的节奏开打。
Difficulty|人机难度
Casual|休闲
Standard|标准
Expert|高手
Casual: steady rallies with room to recover.|休闲：回合节奏舒缓，留出回位时间。
Standard: fast reactions and reliable smash defense.|标准：反应迅速，接杀稳定。
Expert: stronger defense and precise counterattacks.|高手：防守更强，反击落点更精准。
Play Style|人机打法
Balanced|均衡
Defense|防守
Rally|拉吊
Mixes placement and attack from a central position.|以中场为支点，结合落点变化与进攻。
Takes the shuttle early and keeps the pressure on.|积极抢点，持续施加进攻压力。
Stays deep and uses safe clears and lifts.|站位偏后，以稳健的高远球和挑球防守。
Alternates deep clears and drops to find an opening.|交替拉后场、吊网前，寻找空当。
Drill|练习项目
Pace|喂球速度
Slow|慢速
Fast|快速
Net Intercept|网前拦截
Smash Defense|接杀防守
Training drill|专项练习项目
Training pace|专项练习速度
Training length|专项练习球数
Jump on the cue, then right click near the apex.|看到提示后按空格起跳，在最高点附近点击右键。
Follow the ring and intercept at least 0.18 s before landing.|跟随提示圈，在球落地前至少 0.18 秒完成拦截。
Left: lift. Shift + left: block. Low right click: drive.|左键挑球，Shift＋左键挡网，低位右键平抽。
Start Practice|开始练习
Start Match|开始比赛
Start Training|开始专项练习
Start Challenge|开始挑战
Take a breather|休息一下
Take a moment. Pick up where you left off.|稍作休息，准备好后继续。
Resume game|继续游戏
End and review|结束并查看总结
Exit tutorial|退出教程
Exit|退出
How to Play|操作帮助
How to play|操作帮助
WASD / Arrow keys|WASD / 方向键
Move in four directions · Space to jump|四向移动 · 空格键起跳
Left click / Shift + Left click / Right click|鼠标左键 / Shift＋左键 / 鼠标右键
Clear / drop / attack. Against a smash: lift / block / low drive.|高远球 / 吊球 / 进攻。面对杀球时分别为挑球 / 挡网 / 低位平抽。
Your turn to serve|轮到你发球
Left click: long serve. Right click: short serve. Stop moving and serve diagonally.|左键发高远球，右键发小球；停稳后向对角发球区发球。
Touch: move and hit with two thumbs|触屏：双拇指移动与击球
Left joystick: move. Choose Clear, Drop or Attack, then tap the large button to hit. Drag on it left or right to aim; release to swing.|左侧摇杆移动；右侧选择高远球、吊球或进攻，再点大按钮击球。按住左右拖动瞄准，松手挥拍。
Touch: Jump and Power|触屏：起跳与力度
Tap Jump, then hit near the apex. Power opens optional overrides; Auto uses your saved defaults. Release the joystick to serve.|点击起跳，在最高点附近击球。力度菜单可临时调整；自动档使用已保存的默认力度。发球前请松开摇杆。
Backhand shots|反手击球
Left-side shots use a backhand. Controls stay the same; backhand smashes need precise timing.|左侧来球使用反手，操作方式相同；反手杀球需要更精准的时机。
Move the mouse left or right|左右移动鼠标
Move the mouse to aim. Press 1 / 2 / 3 for power.|移动鼠标瞄准，按 1 / 2 / 3 选择力度。
Dashed ring · Get in position|虚线圈 · 移动到位
Solid ring · Ready to hit|实线圈 · 可以击球
Double ring · Perfect timing|双线圈 · 最佳时机
Lift to recover, block to draw the opponent in, drive to counterattack.|挑球争取回位时间，挡网调动对手上前，平抽快速反击。
Lifts use clear power; blocks use drop power; drives use smash power.|挑球沿用高远球力度，挡网沿用吊球力度，平抽沿用杀球力度。
NICE SESSION|练习结束
A good session on court.|今天练得不错。
Play Again|再来一局
Practice Again|再次练习
Court Style|球场风格
Current court preview|当前球场预览
Live preview of the selected court|所选球场实时预览
Choose a court style|选择球场风格
Classic Green|经典绿
Sakura Pink|樱花粉
Sky Blue|天空蓝
Lilac Purple|丁香紫
Marker Colors|提示圈颜色
Reset marker colors|恢复提示圈配色
Landing point|来球落点
Shot aim|回球瞄准
Auto|自动
Auto color|自动配色
Default|默认
Serve|发球
Landing|落点
Combo|连击
Your|你的
Custom color|已有配色
Jersey Colors|球衣配色
Reset colors|恢复配色
Player|玩家
CPU|人机
Choose an athlete to customize their jersey|选择要调整球衣的角色
Choose an athlete to customize their racket|选择要调整球拍的角色
Player jersey front and back preview|玩家球衣正背面预览
CPU jersey front and back preview|人机球衣正背面预览
Main color|主色
Stripe color|条纹色
Choose the main and stripe colors separately. Trim stays unchanged; numbers darken on light jerseys.|主色与条纹可分别设置。保留原有白边，浅色球衣的号码自动加深。
Racket Style|球拍外观
Player racket close-up preview|玩家球拍近景预览
CPU racket close-up preview|人机球拍近景预览
Shape|拍框形状
Racket shape|拍框形状
Classic Oval|经典椭圆
Isometric|方头竞技
Slim Oval|细长轻巧
Head size|拍面大小
Original|原尺寸
Large|加大
Extra Large|更大
Frame color|拍框颜色
Grip color|手胶颜色
Strings and trim match automatically. Size is cosmetic only.|拍线与装饰自动配色。拍面大小仅影响外观。
Ivory|米白
Charcoal|炭灰
Blue|蓝色
Light Blue|浅蓝
Green|绿色
Orange|橙色
Red|红色
Pink|粉色
Purple|紫色
Yellow|黄色
Loading athlete preview...|正在加载角色预览……
Loading racket preview...|正在加载球拍预览……
Touch controls|触屏操作
MOVE|移动
Movement joystick. Drag from the center in any direction.|移动摇杆：从中心向任意方向拖动。
Choose a shot, then tap the large hit button|选择球种，再点击大按钮击球
Jump|起跳
Power|力度
Power for this shot|本球力度
Use defaults|使用默认力度
THIS SHOT|本球力度
This shot|本球力度
Tap to hit · Drag to aim|轻点击球 · 拖动瞄准
Release to hit · Drag to aim|松手击球 · 拖动瞄准
Aim:|瞄准：
Center|中间
Mid-left|中间偏左
Mid-right|中间偏右
Left|左侧
Right|右侧
Wide left|左侧出界区
Wide right|右侧出界区
Long|高远发球
Short|发小球
Long serve|发高远球
Short serve|发小球
Select long serve|选择发高远球
Select short serve|选择发小球
Select clear or lift|选择高远球或挑球
Select drop or block|选择吊球或挡网
Select attack or drive|选择进攻或平抽
. Tap and release to hit; drag left or right before release to aim.|。轻点并松手击球，松手前左右拖动瞄准。
PHONE PLAY|手机操作
Turn for a wider court|横过来，球场更宽
Ready for the court|准备上场
Hold your phone sideways for more room to move and aim. Your thumbs stay beside the court.|横屏可留出更多跑位和瞄准空间，双拇指放在球场两侧。
Your thumbs have their own space beside the court. Start when you are ready.|球场两侧已为双拇指留出操作区，准备好就开始吧。
Move with your left thumb. Choose a shot, then tap and release with your right.|左拇指移动，右侧选择球种，轻点并松手击球。
Continue in portrait|继续竖屏游玩
Play in landscape|横屏开始
SCORE|得分
COMBO|连击
YOU|玩家
You|你
GOALS|达标
FEEDS|喂球
HITS|命中
Practice Court|练习球场
REACTION TRAINING|反应训练
MOVE. TIME. RETURN.|跑位 · 时机 · 回球
Make every return|让每次回球
a better one.|都更进一步。
A little movement. A little timing.|练好脚步，把握时机。
Find your rhythm on the court.|在球场上找到自己的节奏。
COURT 01|球场 01
PERSONAL BEST|个人最高分
Warm-up|热身
Finding your rhythm|渐入佳境
Full pace|全速练习
LV.|等级
Get ready|准备接球
Ready to receive|准备接发球
Your serve|你发球
CPU serve|人机发球
Match complete|比赛结束
You win|你赢了
CPU wins|人机获胜
Match point|赛点
Your match point|你的赛点
CPU match point|人机赛点
Next rally|下一回合
Rally shots|回合拍数
End session|结束练习
End practice and view the summary|结束练习并查看总结
Match scoreboard|比赛记分牌
Badminton game|羽毛球游戏
Available shots for the incoming shuttle|当前来球可用的回球方式
Left click|鼠标左键
Shift + Left click|Shift＋左键
Right click|鼠标右键
⚙ Settings|⚙ 设置
Open settings|打开设置
Fullscreen court|全屏球场
Enter fullscreen|进入全屏
Exit fullscreen|退出全屏
Pause game|暂停游戏
Pause / P|暂停 / P
Sound / M (plays a sample when enabled)|音效 / M（开启时播放试听音）
Mute sound|关闭音效
Enable sound|开启音效
Mute sound (volume is zero)|关闭音效（当前音量为零）
Shuttle Flow Home|Shuttle Flow 首页
Footwork & contact|跑位与击球
Move · Follow the contact ring for low shots|移动 · 低球时跟随击球提示圈
Shot power|击球力度
1 / 2 / 3 or scroll to adjust power. Defaults in Settings.|按 1 / 2 / 3 或滚动滚轮调整本球力度，默认力度可在设置中修改。
Jump smash at the apex|在最高点完成跳杀
Jump · Right click on the gold cue|起跳 · 金色提示时点击右键
Relax your shoulders.|放松肩膀。
Make the next shot count.|认真打好下一球。
A LITTLE COURT, A LITTLE JOY.|小小球场，快乐开打。
P to pause · M to toggle sound|P 暂停 · M 切换音效
Badminton court. Move with WASD or arrow keys; Space to jump. Follow the moving contact ring. Left-side shots use a backhand. Serve with left click for long or right click for short. During rallies: left click for clear, Shift + left click for drop, right click for attack. Keys 1 to 3 set power; move the mouse to aim.|羽毛球场。WASD 或方向键移动，空格起跳，跟随击球提示圈。左侧来球使用反手；发球时左键高远、右键小球；回合中左键高远、Shift＋左键吊球、右键进攻。数字键 1 至 3 调整力度，移动鼠标瞄准。
Tutorial progress|教程进度
Exit tutorial and return home|退出教程并返回首页
YOUR FIRST RALLY|开始你的第一回合
WATCH THE SHUTTLE|观察来球
TIME PAUSED|来球已定格
SHUTTLE HELD|来球等待中
PAUSED AT THE TOP|最高点已定格
WATCH YOUR RETURN|观察回球
LESSON COMPLETE|本课完成
TRY AGAIN|再试一次
Learn on the court, one shot at a time.|在真实球场上，一球一球学会回球。
Move & meet the shuttle|移动到位，接住来球
Choose your direction|选择回球方向
Bring the opponent forward|用吊球调动对手
Attack from the ground|在地面完成点杀
Recover against a smash|挑球化解杀球
Answer with a soft block|轻挡网前
Counter with a flat drive|平抽反击
Jump & strike at the top|起跳，在最高点击球
A clear travels high and deep, giving you time to recover.|高远球飞得高、落得深，能为回位争取时间。
Use WASD or the arrow keys to move into the contact ring. Then left click to return a clear.|用 WASD 或方向键移入击球提示圈，再点击左键回一个高远球。
Move the left joystick toward the contact ring. Choose Clear, then tap and release the large hit button.|用左侧摇杆移入击球提示圈，选择高远球，再轻点并松开大击球按钮。
Your aim chooses the side. Shot type and power control the depth.|瞄准决定左右方向，球种和力度决定回球深度。
Move the mouse left until Shot aim is on the left side. Left click to send a clear there.|向左移动鼠标，让回球瞄准圈落在左侧，再点击左键打高远球。
Choose Clear. Hold the large hit button, drag left to aim at the left side, then release to hit.|选择高远球，按住大击球按钮向左拖动瞄准，再松手击球。
A drop falls near the net and draws the opponent forward.|吊球落在网前，能把对手调到前场。
Hold Shift and left click to play a drop shot. Keep your feet inside the contact ring.|站在击球提示圈内，按住 Shift 点击左键打吊球。
Choose Drop, then tap the large hit button. The label previews the shot you will play.|选择吊球，再轻点大击球按钮；按钮文字会显示实际回球方式。
A standing smash sends the shuttle down without a jump.|点杀不需要起跳，也能打出下压进攻。
Stay on the ground and right click to play a standing smash.|保持站在地面，点击右键完成点杀。
Stay on the ground. Choose Attack, then tap the large hit button to play a standing smash.|保持站在地面，选择进攻，再轻点大按钮完成点杀。
A lift sends a low attack high toward the back court, buying time.|挑球把低位进攻球回到高远的后场，为自己争取时间。
This shuttle is coming down fast. Left click to lift it back to the rear court.|来球正快速下落，点击左键挑回对面后场。
Against a smash, choose Clear. The large button changes to Lift. Tap it to recover.|面对杀球，选择高远球，大按钮会变为挑球；轻点即可化解。
A block absorbs the attack and places the shuttle near the net.|挡网卸去来球力量，让球轻落网前。
Hold Shift and left click to block this low attack softly over the net.|按住 Shift 点击左键，把低位进攻球轻挡过网。
Against a smash, choose Drop. The large button changes to Block. Tap it for a soft return.|面对杀球，选择吊球，大按钮会变为挡网；轻点即可轻挡过网。
A drive counters a low shuttle with a quick, flat return.|平抽把低位来球快速平推回去，用于反击。
Right click on this low shuttle to counter with a drive.|对准低位来球点击右键，用平抽反击。
Against this low shuttle, choose Attack. The large button changes to Drive. Tap to counter.|面对低位来球，选择进攻，大按钮会变为平抽；轻点完成反击。
A jump smash needs both a reachable shuttle and a stable contact near the top of your jump.|跳杀需要来球在可及范围内，并在跳跃最高点附近稳定击球。
Press Space to jump. We will pause you at the top; then right click to smash.|按空格起跳，人物会在最高点定格；再点击右键跳杀。
Choose Attack, then tap Jump. We will pause you at the top; tap and release the large hit button to smash.|选择进攻，再点起跳。人物在最高点定格后，轻点并松开大按钮完成跳杀。
A shuttle will arrive and pause. Learn one action, then try it yourself.|来球到达后会定格，先了解操作，再亲手尝试。
Watch its flight. We will pause before you need to hit.|观察来球轨迹，球会在需要击球前定格。
There is no time limit while the shuttle is held.|来球定格期间没有时间限制。
This shuttle is above standing reach. Jump to meet it.|来球高于站立击球范围，请起跳接球。
The shuttle is frozen. The contact ring shows where to meet it.|来球已定格，击球提示圈显示你需要站到的位置。
Jump now. We will hold you at the top so you can find the smash timing.|现在起跳，人物会在最高点定格，帮助你掌握跳杀时机。
You are in reach. Choose your shot and strike.|你已进入击球范围，选择球种并挥拍。
Move into the contact ring. The shuttle will wait for you.|移入击球提示圈，来球会等待你。
Your jump and the shuttle are paused at the top. Strike now.|人物和来球已在最高点定格，现在挥拍。
Choose Attack, then tap and release the large hit button.|选择进攻，再轻点并松开大击球按钮。
Right click now to play your jump smash.|现在点击右键，完成跳杀。
Your shot is moving again. Watch its arc and where it lands.|回球已恢复飞行，观察弧线和落点。
We check the real return before advancing.|回球实际落地后，才会判断是否通过。
The shuttle was outside your reach. Move closer to the contact ring.|来球超出击球范围，请向击球提示圈靠近。
The shuttle was too high. Use Jump for the jump-smash lesson.|来球太高，跳杀课程需要先起跳。
That swing was too early.|挥拍太早了。
That swing was too late.|挥拍太晚了。
The return went outside the singles lines. Aim farther inside.|回球出了单打边线，请把瞄准位置往场内收。
The return did not clear the net. Try the default power and settle your feet.|回球没有过网，请使用默认力度并站稳脚步。
That clear did not go left. Move your aim farther to the left.|高远球没有打向左侧，请把瞄准位置再往左移。
Try this shot again at your own pace.|按自己的节奏再试这一球。
Send shuttle|开始喂球
Try it|开始尝试
Next lesson|下一课
Finish tutorial|完成教程
Retry shot|重试这一球
READY TO RALLY|准备好上场了
ON-COURT TUTORIAL|球场新手教程
Your first shots, learned.|你已掌握基础回球。
Continue at your own pace.|按自己的节奏继续练习。
Replay Tutorial|重玩教程
Try Feed Practice next to build your timing.|接下来试试喂球练习，继续熟悉击球时机。
LANDING CHALLENGE|落点挑战
Target challenge complete|落点挑战完成
TRAINING COMPLETE|专项练习完成
YOU WIN|你赢了
MATCH COMPLETE|比赛结束
You won. Well played!|你赢了，打得漂亮！
A new match, a fresh start.|再来一场，重新出发。
NEW PERSONAL BEST|刷新个人纪录
Practice complete|练习完成
Main reason for each unsuccessful attempt|每次未达标的主要原因
Position|站位
Timing|时机
Height|高度
Shot choice|球种选择
Out|出界
Recovering|收拍中
Let the racket recover before swinging again.|请等球拍收回后再挥拍。
Stop moving to serve|停稳后再发球
Stand in the highlighted service court and release the joystick.|站在高亮发球区，松开摇杆并停稳。
Stand in the highlighted service court and release movement keys.|站在高亮发球区，松开移动键并停稳。
Outside the service court|不在发球区内
Return to the highlighted service court.|请回到高亮的发球区。
Stay grounded to serve|发球时请保持站立
Move and jump freely after the serve.|发球后即可自由移动和起跳。
No incoming shuttle|暂时没有来球
Wait for the next shuttle before swinging.|等下一球到来后再挥拍。
Wait for the shuttle|等待来球
Get in position; hit after the shuttle crosses the net.|先移动到位，等球过网后再击球。
Too early|挥拍太早
Swing when the ring becomes solid.|等提示圈变实线时再挥拍。
Too late|挥拍太晚
Next time, swing on the solid or double ring.|下一球请在实线圈或双线圈时挥拍。
Too far away|距离太远
Follow the contact ring and get within reach.|跟随击球提示圈，进入可及范围。
Too high|来球太高
Wait for it to drop, or jump to reach higher.|等球下降，或起跳接更高的球。
Racket recovering|球拍收拍中
Move into position before the shuttle crosses|在球过网前移动到位
Contact window missed|已错过击球时机
Shifting weight · Braking|重心转换 · 减速中
Landing recovery|落地恢复中
Ready for the next shuttle|准备接下一球
Release movement keys|松开移动键
Hit now|现在击球
Move here|移动到这里
Backhand · Hit now|反手 · 现在击球
Backhand · Perfect timing!|反手 · 最佳时机！
Backhand smash · Right click!|反手杀球 · 点击右键！
Perfect timing · Right click to smash|最佳时机 · 右键杀球
Perfect timing · Swing!|最佳时机 · 挥拍！
Too high · Wait or jump|来球太高 · 等待或起跳
Ready · Wait for the solid ring|准备好 · 等待实线圈
Move to the contact ring|移动到击球提示圈
Perfect timing · Swing now|最佳时机 · 现在挥拍
Backhand smash · Right click|反手杀球 · 点击右键
Jump smash · Right click|跳杀 · 点击右键
Jump now · Right click at the apex|现在起跳 · 最高点点击右键
Jump now · Attack at the apex|现在起跳 · 最高点点击进攻
Watch for gold · Right click at the apex|观察金色提示 · 最高点点击右键
Watch for gold · Release Attack at the apex|观察金色提示 · 最高点松手进攻
Under pressure · Recovering|承受压力 · 正在回位
CPU chasing|人机追球中
CPU recovering|人机回位中
CPU jumps!|人机起跳！
Prepare to defend; watch the landing point.|准备防守，观察来球落点。
Defend: left to lift · Shift + left to block|接杀：左键挑球 · Shift＋左键挡网
Drive incoming: right click low to counter|平抽来球：低位右键反击
Attack incoming: left to lift · Shift + left to block|进攻来球：左键挑球 · Shift＋左键挡网
Net shot incoming; intercept early|网前来球，提前拦截
Deep shot incoming; move back|后场来球，请向后移动
Reset and get ready for the next shuttle.|调整站位，准备接下一球。
Repeat the same target on the next feed.|下一球继续练习同一目标。
MISSED|漏接
Miss|漏接
Adjust your position for the next shuttle.|调整站位，准备下一球。
Center hit +150|命中中心 +150
Target hit +100|命中目标 +100
Off target|偏离目标
Goal met|目标达成
Try that drill again|再试一次这一项目
Aim left or right; use shot type and power to control depth.|瞄准左右方向，用球种和力度控制回球深度。
Consistent placement. Now aim for the center.|落点很稳定，接下来试试瞄准中心。
Move to the contact ring and swing within reach.|移动到击球提示圈，在可及范围内挥拍。
Try a strong clear for deep targets or a light drop at the net.|后场目标可尝试重力度高远球，网前目标可尝试轻力度吊球。
Aim inside the singles lines. Reduce power for long shots.|瞄准单打边线内，回球过长时降低力度。
Settle your footing; left click to lift a low shuttle.|站稳脚步，低球时可点击左键挑球过网。
No completed feeds yet. Follow the contact ring when you start.|还没有完成的喂球，开始后跟随击球提示圈移动。
All goals met! Try a faster pace and stay consistent.|全部达标！试试更快节奏，并保持稳定。
Move to the contact ring before swinging. Start early for wide shots.|先到击球提示圈再挥拍，边路来球需提前启动。
Intercept after the shuttle crosses the net; do not wait for it to land.|球过网后尽早拦截，不要等到落地前。
Follow the solid ring and return the shuttle within reach.|跟随实线提示圈，在可及范围内回球。
Wait for high shuttles to drop, or jump to reach them.|高球可等它下降，或起跳接球。
Space to jump, then right click on the smash cue. Only jump smashes meet this goal.|按空格起跳，在杀球提示时点击右键；本项仅跳杀算达标。
Defend with a left-click lift, Shift + left block, or low right-click drive.|左键挑球、Shift＋左键挡网，或低位右键平抽进行防守。
Aim within the singles lines and reduce power if shots go long.|瞄准单打边线内，回球过长时降低力度。
Settle your footing or left click to lift over the net.|站稳脚步，或点击左键挑球过网。
Select Attack. Tap Jump on the cue, then release the hit button near the apex.|选择进攻，看到提示后点起跳，在最高点附近松开击球按钮。
Select Drop. Follow the ring and release the hit button early to intercept.|选择吊球，跟随提示圈，提前松开击球按钮完成拦截。
Clear: lift. Drop: block. Attack: low drive. Tap the large button to hit.|高远球选项用于挑球，吊球用于挡网，进攻用于低位平抽；轻点大按钮击球。
Fullscreen unavailable|暂时无法全屏
Fullscreen did not open|未能进入全屏
Using the focused court view.|已使用专注球场视图。
You can continue in the focused court view.|可以继续在专注球场视图中游玩。
Even score: right court|双数分：右发球区
Odd score: left court|单数分：左发球区
Left: long serve / Right: short serve|左键发高远球 / 右键发小球
Left: long / Right: short|左键高远 / 右键小球
Release movement keys to receive|松开移动键准备接发球
CPU will serve diagonally|人机将向对角发球
Choose Long or Short · Tap to serve|选择高远发球或小球 · 轻点发球
Release the joystick to receive|松开摇杆准备接发球
Release the joystick|松开摇杆
Stop moving|停止移动
Stop moving for the CPU serve|停稳，等待人机发球
Ready to receive · Stop moving|准备接发球 · 停止移动
Service court|发球区
Receiving court|接发球区
(backhand smash unavailable)|（当前无法反手杀球）
(outside jump-smash timing)|（未在跳杀时机内）
Too long!|回球太长！
Too low!|回球太低！
CPU scores +1|人机得分 +1
You score +1|你得分 +1
Match complete|比赛结束
Backhand clear|反手高远球
Backhand drop|反手吊球
Backhand smash|反手杀球
Perfect|完美击球
Best combo|最高连击
Standing smashes|点杀
Jump smashes|跳杀
Lifts|挑球
Blocks|挡网
Drives|平抽
Returns|成功回球
Misses|漏接
Centers|中心命中
Hits|命中
Goals|达标
Legal returns|合法回球
Hit rate|命中率
Return rate|回球率
Best streak|最长连续命中
Longest rally|最长回合
Win by 2 at deuce|平分后需净胜 2 分
At deuce: Win by 2|平分后需净胜 2 分
Win by 2|净胜 2 分
Deuce|平分
Cap|最高分
cap|最高分
Feed|第
feeds completed|球已完成
feeds|球
points|分
pts|分
shots|拍
complete|完成
serving|发球中
serve|发球
service court|发球区
Points|分
jump smash|跳杀
Session time:|练习时间：
unlimited practice|不限球数练习
min|分
times|次
Streak:|连续达标：
consecutive hits|次连续命中
lessons completed. Replay whenever you like.|课已完成，随时可以重新学习。
a different shot|其他球种
That was|刚才打出的是
. Try the instructed action.|。请尝试本课要求的动作。
Tap and release to hit; drag left or right before release to aim.|轻点并松手击球，松手前左右拖动瞄准。
Left:|左键：
Shift + left:|Shift＋左键：
Right:|右键：
Backhand|反手
Hold Shift|按住 Shift
Aim|瞄准
Move|移动
Hit|击球
LESSON|课程
of|/
s, unlimited practice|秒，不限球数练习
\n`.trim().split('\n').map(line => { const split = line.indexOf('|'); return [line.slice(0, split), line.slice(split + 1)]; })));
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Longest whole phrases win, so "Jump smash" cannot become a mixture of the
// translations for "Jump" and "Smash". This also covers composed score lines.
const phrases = new RegExp(Object.keys(dictionary).sort((a,b)=>b.length-a.length).map(key =>
  `${/^[A-Za-z]/.test(key) ? '(?<![A-Za-z])' : ''}${escape(key)}${/[A-Za-z]$/.test(key) ? '(?![A-Za-z])' : ''}`).join('|'), 'g');
function translate(value, language = 'en', context) {
  const original = String(value);
  if (language !== 'zh-CN') return original;
  if (context === 'net-area' && original.trim() === 'Net') return '网前';
  if (context === 'preview' && original.trim() === 'Back') return '背面';
  const trimmed = original.trim(), normalized = trimmed.replace(/\s+/g, ' ');
  const translated = dictionary[normalized] ?? trimmed
    .replace(/\bLESSON (\d+) \/ (\d+)\b/g, '第 $1 课 / 共 $2 课')
    .replace(/\bRally: (\d+) shots\b/g, '本回合：$1 拍')
    .replace(/\bRally (\d+)\b/g, '本回合 $1 拍')
    .replace(/\bFeed (\d+)\b/g, '第 $1 球')
    .replace(/\b(\d+) consecutive hits\b/g, '连续命中 $1 球')
    .replace(/\b(\d+) lessons completed\. Replay whenever you like\./g, '已完成 $1 课，随时可以重新学习。')
    .replace(/\b(\d+) of (\d+) feeds completed\b/g, '已完成 $1 / $2 球')
    .replace(/\b(\d+) feeds completed\b/g, '已完成 $1 球')
    .replace(/Session time: (\d+) min (\d+) s, unlimited practice/g, '练习时间：$1 分 $2 秒，不限球数')
    .replace(phrases, phrase => dictionary[phrase]);
  return original.slice(0, original.length - original.trimStart().length) + translated + original.slice(original.trimEnd().length);
}
function createLocalizer({ document, storage }) {
  let language = 'en';
  try { if (storage?.getItem(storageKey) === 'zh-CN') language = 'zh-CN'; } catch { /* Session switching works without storage. */ }
  const source = Symbol('englishPresentationSource'), listeners = new Set();
  const model = element => element[source] ??= { attributes: {} };
  const t = (value, context) => translate(value, language, context);
  function text(element, value) {
    const english = String(value), data = model(element);
    if (data.text === english && data.language === language) return;
    delete data.html; data.text = english; data.language = language;
    element.textContent = t(english, element.dataset?.i18nContext);
  }
  function html(element, value) {
    const english = String(value), data = model(element);
    if (data.html === english && data.language === language) return;
    delete data.text; data.html = english; data.language = language;
    // Only trusted game-authored markup is accepted by the existing callers.
    element.innerHTML = english.split(/(<[^>]*>)/g).map(part => part.startsWith('<') ? part : t(part)).join('');
  }
  function attr(element, name, value) {
    const english = String(value), data = model(element);
    data.attributes[name] = english;
    const translated = t(english);
    if (element.getAttribute(name) !== translated) element.setAttribute(name, translated);
  }
  function node(value) {
    const element = document.createTextNode(String(value)); text(element, value); return element;
  }
  function apply(element) {
    if (!element || ['SCRIPT','STYLE'].includes(element.tagName)) return;
    const data = model(element);
    if (element.nodeType === 3) {
      if (data.text === undefined) data.text = element.nodeValue;
      element.nodeValue = t(data.text, element.parentElement?.dataset?.i18nContext); return;
    }
    for (const name of ['aria-label','title','aria-valuetext']) {
      const value = data.attributes[name] ?? element.getAttribute?.(name);
      if (value != null) attr(element, name, value);
    }
    if (data.html !== undefined) { const english = data.html; data.language = null; html(element, english); }
    else if (data.text !== undefined) { const english = data.text; data.language = null; text(element, english); }
    else for (const child of Array.from(element.childNodes ?? [])) apply(child);
  }
  function refresh() {
    document.documentElement.lang = language;
    apply(document.body);
    for (const button of document.querySelectorAll('[data-language]')) {
      const selected = button.dataset.language === language;
      button.setAttribute('aria-pressed', String(selected)); button.classList.toggle('selected', selected);
    }
  }
  function setLanguage(value) {
    if (!['en','zh-CN'].includes(value)) return false;
    language = value; let saved = true;
    try { storage?.setItem(storageKey, value); } catch { saved = false; }
    refresh(); for (const listener of listeners) listener(language, saved);
    return saved;
  }
  return Object.freeze({ t, text, html, attr, node, refresh, setLanguage,
    get language() { return language; },
    sourceAttribute: (element, name) => element[source]?.attributes[name] ?? element.getAttribute(name),
    onChange(listener) { listeners.add(listener); }
  });
}
globalThis.ShuttleI18n = Object.freeze({ createLocalizer, translate, dictionary, storageKey });
})();
