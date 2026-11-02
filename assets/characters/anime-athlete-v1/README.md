# Shuttle Flow 简洁动漫运动员 · 3D 原型 v1.1

这是原创程序建模得到的真实 GLB 模型，有网格、材质、骨骼蒙皮和动画。配色参考上一级目录的 `anime-athlete-concept-v1.png`，造型与细节按首版原型简化。

## 打开预览

- 当前电脑双击项目根目录的 `查看3D角色.lnk`，或运行 `npm run preview:athlete`。
- 也可直接双击本目录 `preview.html`，使用支持 WebGL 2 的现代浏览器。
- 拖动旋转、滚轮缩放；无鼠标时可用正面、侧面、背面和斜侧按钮，或开启自动旋转。可切换动画、暂停、调速、隐藏球拍和查看骨骼。
- 网页预览无需启动服务器或联网；模型字节已嵌入本地 `preview.js`，避免浏览器的本地文件加载限制。移动或分享预览时同时保留 `preview.html` 和 `preview.js`。如还需导入其他软件，同时保留 `athlete.glb`。
- Electron 预览使用 `artifacts/.athlete-preview-profile/` 独立配置，不读取原游戏的设置和最高分。

## 模型内容

- `athlete.glb`：约 1.44 MiB 的 glTF 2.0 二进制模型，可导入支持 GLB 的建模软件或 Three.js。
- 约 2.29 万个三角面，29 个骨骼，17 个材质，无外部贴图或纹理加载。
- 包含头部、简洁五官与黑色短发、浅绿运动球衣、深青短裤、白袜、鞋子、护腕与羽毛球拍。
- 7 个基础动画：Idle（站立）、Run（原地跑动）、Sidestep（并步）、Jump（起跳）、Forehand（正手）、Backhand（反手）、Smash（跳杀）。预览循环播放；正式游戏可将挥拍和跳跃设置为单次播放。
- Y 轴向上，+Z 为人物前方，单位为米。持拍手为 `RightHand`，球拍节点为 `BadmintonRacket`，拍面中心定位点为 `RacketContact`。
- 正式游戏的平移由游戏规则控制；Run 提供原地步态，Sidestep 暂含展示用横向跟进，Jump / Smash 暂含 Hips 的展示用升降轨迹。接入游戏时须把位移和升降交给现有游戏状态，并重新按实际地面位置设置脚部目标，避免重复叠加。
- 腿部增加 `UpperLegTwist` / `LowerLegTwist`、`Heel` / `ToeTip`，脚趾和脚跟实际参与鞋子的蒙皮，膝部补充细分环和过渡权重。小腿与大腿扭转、脚踝和脚趾可以分别调整。手指、服装和发型仍为简化结构，尚无精细表情或布料模拟。

## v1.1 动作修正

- 起跳和跳杀：使用两段腿部逆运动学，将膝盖弯曲约束到人物前方；按下蹲、蹬地、腾空、落地缓冲分阶段设置髋部和脚部目标，鞋底在支撑阶段固定到地面。
- 并步：迈步、跟进、反向迈步、跟进四阶段交替支撑，保留脚间距离，支撑脚不随髋部横向滑动。
- 反手：按胸前手腕路径求解肩—肘—腕关节，肘部向外展开；回收同样走胸前路径，减少手臂穿过球衣的问题。
- 跑动和其他挥拍沿用新的腿部控制，膝盖保持正确弯曲方向。
- 合并动图：`artifacts/athlete-3d-motion-fixed.gif`；单项动图：`athlete-3d-{jump,sidestep,backhand}-fixed.gif`。

## 当前边界

模型已接入实际游戏，双击项目根目录 `启动游戏.lnk` 试玩。游戏渲染适配源文件是 `scripts/athlete-game.mjs`，构建生成本目录 `game-renderer.js`，其中嵌入模型字节，直接打开 `index.html` 也能离线加载。玩家浅绿球衣、人机米色球衣，透明 3D 人物与原 Canvas 球场按球网前后顺序合成；不支持 WebGL 时自动使用原 Canvas 人物。

游戏规则继续控制平移、跳跃高度和触球时刻；适配层去除 GLB 展示位移，并按真实球位修正肩—肘—腕与球拍中心。现阶段并步和跑动使用原地动画，尚未实现完整的世界空间脚掌锁定；原有接球容错范围可能超过自然手臂长度，适配层在触球姿势中适度延长手臂。反手没有全身碰撞求解，仍需试玩判断动作观感。独立预览中的动作约束验证不能等同于游戏任意触球姿势都已消除穿模。

## 修改与重新生成

造型、配色和骨骼源文件为 `scripts/lib/athlete-model.mjs`；腿部控制、手臂控制和动画源文件为 `scripts/lib/athlete-motion.mjs`。预览逻辑为 `scripts/athlete-preview.mjs`，预览布局为 `scripts/athlete-preview.html`。不要直接修改生成的 `preview.js`。

```powershell
npm run build:athlete
npm run athlete:shortcut
npm run verify:athlete
```

重建后关闭预览再重新打开。项目路径变更后重新生成快捷方式。构建工具 Three.js / esbuild 与验证工具 gltf-validator 为固定版本开发依赖，预览运行不依赖 Node 服务或 CDN。

验证脚本检查最终 GLB 的格式、导入骨骼、所有动画的变形范围、真实 Electron 的离线预览与控件、播放/暂停、桌面与移动布局，并输出 `artifacts/athlete-3d-*.png`。`scripts/lib/verify-athlete-motion.mjs` 对导入后的每个动画抽样 121 帧，检查膝盖弯曲方向和屈曲范围、实际鞋底高度、支撑脚滑动、并步脚间距离与反手手臂对躯干的近似包络避让；报告为 `artifacts/athlete-motion-checks.json`。这不是全模型任意姿势的碰撞求解，自动检查不代替用户对外观和动作的反馈。

实际渲染动图可重新生成（需要 Python 与 Pillow）：

```powershell
npm run verify:athlete -- --motion-previews
python scripts/render-athlete-motion-gifs.py
```

Three.js 为 MIT 许可，见 `THIRD_PARTY_LICENSE.txt`。
