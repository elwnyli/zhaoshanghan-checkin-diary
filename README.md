# 赵尚涵大王的打卡日记

手机优先的上下班打卡小站：每周有早上、中午、下午、晚上四个时段；点方格即可盖“赵”字印章。

在线地址：<https://elwnyli.github.io/zhaoshanghan-checkin-diary/>

## 使用方式

- 点空白方格完成打卡；再点一次撤销。
- 日期栏左右切换周、月或年；中间按钮回到当前时间。
- “周／月／年”支持逐级缩小、放大切换：月历点日期会打开对应周，年历点月份会打开对应月。
- 新打卡会先自动保存到当前浏览器；连接 GitHub 后会合并并写入仓库。

## GitHub 公开同步

打卡数据保存在公开文件 [`data/checkins.json`](https://github.com/elwnyli/zhaoshanghan-checkin-diary/blob/main/data/checkins.json)，因此：

- 任意手机打开网页都会先读取这份公开记录；
- 要从某台设备新增或撤销打卡时，在该设备点击“连接 GitHub”，粘贴一枚**细粒度个人访问令牌**；
- 创建令牌时只选择 `elwnyli/zhaoshanghan-checkin-diary`，并只授予 `Contents: Read and write`；
- 令牌仅保存在该设备的浏览器中，并只随请求发送给 `api.github.com`，不会提交进仓库或网页源码；
- 每台会写入数据的设备可单独创建一枚令牌。设备遗失或不再使用时，可在 GitHub 的令牌设置中撤销该设备的令牌。

同步采用“单个方格按最后修改时间合并”的方式，撤销也会同步。公开仓库意味着所有能访问仓库的人都能看到打卡记录；GitHub 的提交历史可作为额外的恢复线索，但不应把它当作唯一备份。

## 部署

网站从 `main` 分支根目录由 GitHub Pages 发布。它是静态网站：没有自建服务器，也不使用第三方分析或数据库服务。
