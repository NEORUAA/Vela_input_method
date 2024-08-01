import { dict } from './dic.js'

var SimpleInputMethod = {
    dict: {}
}

SimpleInputMethod.initDict = function(){
    this.dict.py2hz = dict;
    this.dict.py2hz2 = {};
    this.dict.py2hz2['i'] = 'i'; // i比较特殊，没有符合的汉字，所以特殊处理
    for(var i=97; i<=123; i++)
    {
        var ch = String.fromCharCode(i);
        if(!this.dict.py2hz[ch])
        {
            for(var j in this.dict.py2hz)
            {
                if(j.indexOf(ch) == 0)
                {
                    this.dict.py2hz2[ch] = this.dict.py2hz[j];
                    break;
                }
            }
        }
    }
}

SimpleInputMethod.getSingleHanzi = function(pinyin){
    return this.dict.py2hz2[pinyin] || this.dict.py2hz[pinyin] || '';
}

SimpleInputMethod.getHanzi = function(pinyin){
    var result = this.getSingleHanzi(pinyin);
    if(result) return [result.split(''), pinyin];
    var temp = '';
    
    var start = pinyin.length;
    if(start > 6){
        start = 6
    }
    for(var i = start;i >= 1;i--){
        var str = pinyin.substr(0, i);
        var rs = this.getSingleHanzi(str);
        if(rs) return [rs.split(''), str];
    }
    
    // for(var i=0, len = pinyin.length; i<len; i++)
    // {
    //     temp += pinyin[i];
    //     result = this.getSingleHanzi(temp);
    //     if(!result) continue;
    //     // flag表示如果当前能匹配到结果、并且往后5个字母不能匹配结果，因为最长可能是5个字母，如 zhuang
    //     var flag = false;
    //     if((i+1) < pinyin.length)
    //     {
    //         for(var j=1, len = pinyin.length; j<=5 && (i+j)<len; j++)
    //         {
    //             if(this.getSingleHanzi(pinyin.substr(0, i+j+1)))
    //             {
    //                 flag = true;
    //                 break;
    //             }
    //         }
    //     }
    //     if(!flag) return [result.split(''), pinyin.substr(0, i+1) + "'" + pinyin.substr(i+1)];
    // }
    return [[], '']; // 理论上一般不会出现这种情况
}

SimpleInputMethod.initDict();

export { SimpleInputMethod }