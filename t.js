var fs = require('fs')
var path  = require('path')
var cheerio = require('cheerio')
var toMarkdown = require('to-markdown')
var filePath = path.resolve('./2017')
fs.readdir(filePath, function(err, files) {
    if (err) {
        console.log(err)
    }
    files.forEach(function(fileName) {
        fs.stat(path.join(filePath, fileName), function(err, stats){
            if (stats.isFile()) {
                writeFile('', fileName)
            } else {
                var name = fileName
                readFile(path.join(filePath, fileName), name)
            }
        })
    })
})
/**
 * 读取目录
 * @param readUrl
 * @param name
 */
function readFile(readUrl, name){
    var name = name
    fs.readdir(readUrl, function(err, files){
        if(err){
            console.log(err);
            return;
        }
        files.forEach(function(fileName){
            fs.stat(path.join(readUrl, fileName), function(err, stats){
                if (err) throw err
                //是文件
                if(stats.isFile()){
                  writeFile(name, fileName)
                //是子目录
                }else if(stats.isDirectory()){
                    var dirName = fileName
                    readFile(path.join(readUrl, fileName), name + '/' + dirName)
                }
            })
        })
    })
}
/**
 * 提取内容，写入文件
 * @param name
 * @param fileName
 */
function writeFile(name, fileName) {
    // console.log(`fileName`,fileName,path.extname(fileName))
    if (path.extname(fileName) !== '.html') {
        return
    }
    var newUrl = path.join(name, fileName)
    var p = path.join(filePath, newUrl)
    // 转为markdown
    var html = toMarkdown(fs.readFileSync(p, 'utf8').toString())
    // 解析html,decodeEntities为false表示关闭实体编码转换
    var $ = cheerio.load(html, { decodeEntities: false })
    // 标题
    var title = $('.post-title').text() || ''
    // 发表日期
    var date = $('.post-time time').attr('content') || ''
    // 头部内容
    var header = `+++\ntitle= "${title}"\ndate= ${date}\ntags="" \n+++\n `
    // 主体内容
    var post = $('.post-body').html() || ''
    // 1 替换高亮代码中的行数
    // 2 提取带链接的标题内容
    // 提取高亮代码，用"```"包裹
    var docs = header +
        post.replace(/<td class="gutter">[\s\S]*?<\/td>/g, '')
            .replace(/(#* )\[\]\(#([\s\S]*?) "([\s\S]*?)"\)\3/g,'$1$2')
            .replace(/<figure[^>]*?>[\S\s]*?<pre>([\s\S]*?)<\/pre>[\s\S]*?<\/figure>/g, function(match, s1) {
                return '```\n' + cheerio.load(s1, {decodeEntities: false}).text() + "\n```"
            })

            // console.log(`docs`,docs)
    // 输出路径
    var outUrl = newUrl.replace(/\//g, '-').replace(/\s/g, '').replace(/\-index.html/, '.md')
    // console.log(`outUrl`,outUrl)
    // 写入内容
    fs.open(path.join(__dirname, outUrl), "w",function(err, fd){
        var buf = new Buffer(docs)
        fs.write(fd, buf, 0, buf.length, 0, function(err, written, buffer){})
    })
}